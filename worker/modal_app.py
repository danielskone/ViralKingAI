"""ViralKing AI GPU worker.

Runs open-weight models on Modal GPUs (pay per second, scales to zero):
  - Script writer: Qwen2.5-7B-Instruct (Apache 2.0) turns an offer into scene prompts.
  - Video generator: Wan 2.2 TI2V-5B (Apache 2.0), text-to-video and image-to-video.

Flow: the web app inserts a `script` job into Supabase and POSTs its id to `submit`.
The script job writes scenes, then queues one `video` job per scene. Each video job
renders a clip, uploads it to the private `media` bucket and records an asset row.

Deploy:  modal deploy worker/modal_app.py
Secrets: modal secret create viralking-secrets SUPABASE_URL=... \
           SUPABASE_SERVICE_ROLE_KEY=... WORKER_SHARED_SECRET=...
"""

from __future__ import annotations

import io
import json
import os
import re
import time

import modal

APP_NAME = "viralking-ai"
LLM_ID = "Qwen/Qwen2.5-VL-7B-Instruct"  # sees the product photo, so scripts describe the real product
VIDEO_ID = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
EDIT_ID = "Qwen/Qwen-Image-Edit"  # Apache 2.0; puts the product on a model for the first frame
EDIT_STEPS = 20  # 20 is plenty for a product-in-hand photo
MODELS_DIR = "/models"

# Wan 2.2 TI2V-5B native resolution is 1280x704 (or 704x1280), 24 fps.
SIZES = {"9:16": (704, 1280), "16:9": (1280, 704), "1:1": (960, 960)}
FPS = 24
NUM_FRAMES = 121  # ~5 seconds; must be 4k+1
STEPS = int(os.environ.get("WAN_STEPS", "25"))  # 25 keeps quality, ~40% less GPU than 40
VIDEO_TIMEOUT = 3600  # seconds Modal lets one clip run (photo edit + animation + voice)
RENDER_BUDGET = VIDEO_TIMEOUT - 240  # stop early so the job is marked failed, not left "running"
# Wan's own recommended negative prompt (the model was trained with it), plus English extras.
NEGATIVE = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，"
    "JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，"
    "手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走, "
    "blurry, low quality, distorted, deformed hands, extra fingers, watermark, text, logo artifacts, flicker"
)

app = modal.App(APP_NAME)
models = modal.Volume.from_name("viralking-models", create_if_missing=True)
secrets = [modal.Secret.from_name("viralking-secrets")]

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .pip_install(
        "torch==2.7.1",
        "torchvision==0.22.1",  # the photo model's image processor needs it
        "diffusers==0.35.2",
        "transformers==4.57.1",
        "accelerate==1.10.1",
        "sentencepiece",
        "ftfy",
        "imageio[ffmpeg]",
        "pillow",
        "numpy",
        "supabase==2.22.4",
        "huggingface_hub[hf_transfer]",
    )
    .env({"HF_HOME": MODELS_DIR, "HF_HUB_ENABLE_HF_TRANSFER": "1",
          "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"})
)
# Talking avatars: Kokoro-82M text-to-speech (Apache 2.0) + LatentSync 1.6 lip-sync (Apache 2.0).
# LatentSync pins its own older torch/diffusers, so it lives in its own image.
LS_DIR = "/opt/LatentSync"
LS_COMMIT = "a229c3948406bc2cf6eaf4873e662e70c6a04746"
talk_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0", "espeak-ng", "build-essential")
    .pip_install("torch==2.5.1", "torchvision==0.20.1", index_url="https://download.pytorch.org/whl/cu121")
    .pip_install(
        "diffusers==0.32.2", "transformers==4.48.0", "decord==0.6.0", "accelerate==0.26.1",
        "einops==0.7.0", "omegaconf==2.3.0", "opencv-python==4.9.0.80", "mediapipe==0.10.11",
        "python_speech_features==0.6", "librosa==0.10.1", "scenedetect==0.6.1", "ffmpeg-python==0.2.0",
        "imageio==2.31.1", "imageio-ffmpeg==0.5.1", "face-alignment==1.4.1", "huggingface-hub==0.30.2",
        "numpy==1.26.4", "kornia==0.8.0", "insightface==0.7.3", "onnxruntime-gpu==1.21.0",
        "DeepCache==0.1.1", "soundfile", "kokoro==0.9.4", "hf_transfer", "matplotlib", "tqdm",
        "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
    )
    .run_commands(f"git clone https://github.com/bytedance/LatentSync {LS_DIR} && cd {LS_DIR} && git checkout {LS_COMMIT}")
    .env({"HF_HOME": MODELS_DIR, "HF_HUB_ENABLE_HF_TRANSFER": "1", "PYTHONPATH": LS_DIR})
)
LIPSYNC_STEPS = int(os.environ.get("LIPSYNC_STEPS", "12"))  # was 20; mouths still look right
TALK_SECONDS = NUM_FRAMES / FPS  # one spoken line per ~5 s clip

web_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]", "supabase==2.22.4"
)
with web_image.imports():
    from fastapi import HTTPException, Request


def _sb():
    from supabase import create_client

    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def _claim(sb, job_id: str) -> dict | None:
    """Move a job from queued to running exactly once, so retries never run it twice."""
    res = (
        sb.table("generation_jobs")
        .update({"status": "running"})
        .eq("id", job_id)
        .eq("status", "queued")
        .execute()
    )
    return res.data[0] if res.data else None


def _finish(sb, job_id: str, *, output=None, error=None, gpu_seconds=None):
    sb.table("generation_jobs").update(
        {
            "status": "failed" if error else "succeeded",
            "output": output,
            "error": (error or None) and str(error)[:2000],
            "gpu_seconds": gpu_seconds,
        }
    ).eq("id", job_id).execute()


def _stage(sb, job_id: str, stage: str, t0: float):
    """Record how far a running job has got, so a slow or stuck step is visible in the database."""
    try:
        sb.table("generation_jobs").update(
            {"output": {"stage": stage, "seconds": round(time.time() - t0)}}
        ).eq("id", job_id).execute()
    except Exception as e:  # noqa: BLE001
        print(f"stage update failed: {e!r}", flush=True)
    print(f"[{job_id}] {stage} at {time.time() - t0:.0f}s", flush=True)


def _settle_project(sb, project_id: str):
    """When no jobs are left running, mark the project ready (or failed if nothing worked)."""
    jobs = (
        sb.table("generation_jobs")
        .select("status, job_type")
        .eq("project_id", project_id)
        .execute()
        .data
    )
    if any(j["status"] in ("queued", "running") for j in jobs):
        return
    ok = any(j["status"] == "succeeded" and j["job_type"] == "video" for j in jobs)
    sb.table("projects").update({"status": "ready" if ok else "failed"}).eq("id", project_id).execute()


def _append_card(video: bytes, card_png: bytes, w: int, h: int, seconds: float = 2.0) -> bytes:
    """Add a still card to the end of a clip, keeping the clip's sound if it has any."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        src, card, out = f"{d}/in.mp4", f"{d}/card.png", f"{d}/out.mp4"
        open(src, "wb").write(video)
        open(card, "wb").write(card_png)
        has_audio = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", src],
            capture_output=True, text=True,
        ).stdout.strip() != ""
        vf = f"fps={FPS},scale={w}:{h},setsar=1,format=yuv420p"
        cmd = ["ffmpeg", "-y", "-i", src, "-loop", "1", "-t", str(seconds), "-i", card]
        if has_audio:
            cmd += ["-f", "lavfi", "-t", str(seconds), "-i", "anullsrc=r=44100:cl=stereo",
                    "-filter_complex", f"[0:v]{vf}[a0];[1:v]{vf}[a1];[0:a]aresample=44100,aformat=channel_layouts=stereo[s0];"
                    "[a0][s0][a1][2:a]concat=n=2:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]", "-c:a", "aac"]
        else:
            cmd += ["-filter_complex", f"[0:v]{vf}[a0];[1:v]{vf}[a1];[a0][a1]concat=n=2:v=1:a=0[v]", "-map", "[v]"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
        subprocess.run(cmd, check=True, capture_output=True)
        return open(out, "rb").read()


# --------------------------------------------------------------------------- script


@app.cls(gpu=["L4", "A10G", "L40S"], image=gpu_image, volumes={MODELS_DIR: models}, secrets=secrets,
         timeout=600, scaledown_window=120)
class ScriptWriter:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

        # Keep photos small so the model fits on a 24 GB GPU.
        self.proc = AutoProcessor.from_pretrained(LLM_ID, min_pixels=256 * 28 * 28, max_pixels=640 * 28 * 28)
        self.model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            LLM_ID, torch_dtype=torch.bfloat16, device_map="cuda"
        )
        models.commit()

    def _chat(self, system: str, user: str, image=None, max_new_tokens: int = 1600, temperature: float = 0.8) -> str:
        content = ([{"type": "image"}] if image is not None else []) + [{"type": "text", "text": user}]
        msgs = [{"role": "system", "content": [{"type": "text", "text": system}]},
                {"role": "user", "content": content}]
        text = self.proc.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
        batch = self.proc(text=[text], images=[image] if image is not None else None, return_tensors="pt").to("cuda")
        out = self.model.generate(**batch, max_new_tokens=max_new_tokens, temperature=temperature,
                                  top_p=0.9, do_sample=True)
        return self.proc.batch_decode(out[:, batch["input_ids"].shape[1]:], skip_special_tokens=True)[0]

    def _describe(self, image) -> str:
        """Say exactly what the product in the customer's photo is, so nothing gets invented."""
        return self._chat(
            "You describe product photos for ad scripts. Be literal and specific.",
            "What exactly is the product in this photo? In 2-3 sentences give: what it is (and how many "
            "pieces if it is a set), its colors, prints or patterns, materials, and any text or brand on it. "
            "Do not guess anything you cannot see.",
            image=image, max_new_tokens=200, temperature=0.2,
        ).strip()

    def _write(self, title: str, offer: str, idea: str, subject: str, n: int, talk: bool = False,
               product_name: str = "", product_desc: str = "") -> dict:
        system = (
            "You are an award-winning commercial director writing shot prompts for the Wan 2.2 "
            "AI video model. Each prompt is one continuous 5-second shot. Write prompts like a "
            "cinematographer: name the subject and what they look like, the exact action, the "
            "setting, the camera move (slow dolly in, tracking shot, orbit, handheld), the lens "
            "and framing (close-up, medium shot, 35mm, shallow depth of field), the lighting "
            "(golden hour, soft window light, neon) and the mood. Be literal and concrete; one "
            "main action per shot; no on-screen text or logos. Reply with JSON only."
        )
        example = (
            "Medium tracking shot of a confident young woman in a cream knit sweater walking "
            "down a cobblestone street at golden hour, warm sunlight flaring through the trees "
            "behind her, she glances at the camera and smiles, fabric moving naturally with "
            "each step, shallow depth of field, 35mm lens, soft film grain, premium fashion "
            "commercial look."
        )
        if subject in ("product_model", "product_avatar"):
            who = ("the person from the customer's avatar photo" if subject == "product_avatar"
                   else "a fitting, attractive person")
            photo_rule = (
                "The customer uploaded a product photo. For scene 1 ALSO write \"first_frame\": a "
                f"40-70 word image-editing instruction for a photorealistic photo of {who} wearing or "
                "using this exact product (keep its color, print, logo and details exactly the same) "
                "in the setting of the idea, described like a fashion photo (pose, setting, light, "
                "framing). Scene 1's \"prompt\" then describes that same person and setting and the "
                "motion that follows."
            ) + (" Scenes after scene 1 start from the plain avatar photo, so their prompts describe that "
                 "person talking to the camera and do not show the product." if subject == "product_avatar" else "")
        elif subject == "avatar":
            photo_rule = (
                "Scene 1 starts from the customer's photo of a person (their avatar). Its prompt must "
                "describe that person performing the idea (action, expression, camera move, light); "
                "keep their look unchanged. Every later scene starts from the same photo, so describe the "
                "same person in each one."
            )
        elif subject == "product":
            photo_rule = (
                "The customer uploaded a product photo. Scene 1 starts from that exact photo, so its "
                "prompt must describe the product as the hero of the shot and the motion around it "
                "(camera move, light, subtle product movement); do not invent a different product."
            )
        else:
            photo_rule = "No photo was uploaded; describe every scene fully."
        sells = subject != "avatar" or bool(product_name)
        thing = f'the product ("{product_name}")' if product_name else "the product"
        cta_rule = (
            f"The LAST scene's line is the call to action and must sell {thing}: name the product (or say "
            "\"this\" if no real name is given), give one reason to act now (a deal, limited stock, a deadline "
            "like Christmas, or how good it feels), and say exactly what to do, e.g. \"Honestly, grab these "
            "before Christmas, tap the link!\" or \"Trust me, get yours today, link's right below!\". "
            "With only 1 scene, that one line is a quick hook plus the call to action."
            if sells else
            "The LAST scene's line ends with a clear call to action (follow, comment, or tap the link)."
        )
        human_rule = (
            "Lines must sound like a real person talking to a friend, not an announcer or an ad: first "
            "person, contractions (I'm, you're, it's), short natural phrases, a little emotion or surprise "
            "(\"okay, I'm obsessed\", \"no joke\", \"look at this\"), one concrete detail they can see or "
            "feel. No buzzwords like \"elevate\", \"game-changer\", \"must-have\" or \"introducing\". Scene 1's "
            "line is a scroll-stopping hook in the first 3 words (a question, a surprise, or a bold claim). "
            "The lines flow together as one short story: hook, why they love it, call to action."
        )
        if talk and subject != "product":
            same_person = (
                " Every scene starts from the same photo of this person, so describe the SAME person "
                "(same face, hair and clothes) in every prompt; only the expression, gestures and camera "
                "move change." if subject in ("avatar", "product_avatar") else "")
            talk_rule = (
                "The person TALKS to the camera in every scene, like a real UGC creator filming on their "
                "phone. In each prompt, frame them in a medium close-up facing the camera, speaking with "
                "natural, lively expressions (smiling, raised eyebrows, a nod, hand gestures), gentle head "
                "movement, mouth clearly visible, nothing covering the face, soft natural light." + same_person +
                " For each scene also write \"line\": exactly what they say out loud, 8-12 words. "
                + human_rule + (" Every line is about the product: what it is, a detail they love, and why the "
                "viewer needs it." if subject in ("product_model", "product_avatar") else "") + " " + cta_rule
            )
        elif talk:
            talk_rule = (
                "A narrator speaks over the video. For each scene also write \"line\": the voice-over for "
                "that shot, 8-12 words, warm and persuasive. " + human_rule + " " + cta_rule
            )
        else:
            talk_rule = ""
        name_line = (f'Product name: "{product_name}" (if this looks like a file name such as IMG_1234 or '
                     '"Product from amazon.com", it is not a real name: call it "this" instead).'
                     if product_name else "")
        desc_line = (f"THE PRODUCT (from the customer's actual photo): {product_desc} Every prompt, line, "
                     "caption and first_frame must describe exactly this product with these colors and details. "
                     "Never call it anything else and never invent a different product."
                     if product_desc else "")
        user = f"""Project: "{title}". Business / offer: "{offer or title}".
{desc_line}
Customer's idea for the video: "{idea or 'not given; choose a strong, scroll-stopping concept for this offer'}".
{photo_rule}
{talk_rule}

{name_line}
Write {n} scene(s) for a short social media ad that follows the customer's idea closely. It must sell:
the last scene shows the product clearly (in hand, worn, or as the hero of the shot) so the call to
action lands, and its caption is the call to action.
For each scene give:
- "prompt": 70-110 words, in the style of this example: "{example}"
- "caption": on-screen text for that scene, max 8 words.
Also give "hook" (max 8 words) and "cta" (max 6 words): an urgent call to action that names the product
when a real name is known, e.g. "Get yours before they're gone" or "Tap the link, grab yours".
JSON shape: {{"hook": str, "cta": str, "scenes": [{{"prompt": str, "caption": str, "line": str (when asked), "first_frame": str (scene 1 only, when asked)}}]}}"""
        text = self._chat(system, user)
        match = re.search(r"\{.*\}", text, re.S)
        data = json.loads(match.group(0) if match else text)
        scenes = [s for s in data.get("scenes", []) if s.get("prompt")][:n]
        if not scenes:
            raise ValueError("Script model returned no scenes")
        cta = (data.get("cta") or "").strip()
        if talk and cta:
            # The viewer must HEAR the call to action, so make sure the last line has one.
            last = (scenes[-1].get("line") or "").strip()
            cta_words = ("link", "grab", "get yours", "get one", "get these", "shop", "order", "buy", "tap")
            if not any(k in last.lower() for k in cta_words):
                joined = f"{last.rstrip('.!?')}! {cta}".strip("! ") if last else cta
                scenes[-1]["line"] = joined if len(joined.split()) <= 14 else cta
        return {"hook": data.get("hook", ""), "cta": cta, "scenes": scenes}

    @modal.method()
    def run(self, job_id: str):
        sb = _sb()
        job = _claim(sb, job_id)
        if not job:
            return
        project_id = job["project_id"]
        t0 = time.time()
        try:
            project = sb.table("projects").select("*").eq("id", project_id).single().execute().data
            images = (
                sb.table("assets").select("storage_path").eq("project_id", project_id)
                .eq("kind", "image").order("created_at").execute().data
            )
            n = int(job["input"].get("scene_count", 3))
            inp = job["input"]
            idea = (inp.get("idea") or "").strip()
            product = inp.get("product_path")
            avatar = inp.get("avatar_path")
            if product:
                first_image = product
                model_shot = bool(inp.get("model_shot")) or bool(avatar)
                subject = ("product_avatar" if avatar else "product_model") if model_shot else "product"
            elif avatar:
                first_image, model_shot, subject = avatar, False, "avatar"
            else:  # older projects: first uploaded photo
                first_image = images[0]["storage_path"] if images else None
                model_shot = bool(inp.get("model_shot")) and bool(first_image)
                subject = ("product_model" if model_shot else "product") if first_image else "none"
            voice = inp.get("voice") or None
            product_desc = ""
            if product:
                try:
                    from PIL import Image

                    img = Image.open(io.BytesIO(sb.storage.from_("media").download(product))).convert("RGB")
                    product_desc = self._describe(img)
                except Exception as de:  # noqa: BLE001
                    print(f"could not describe the product photo: {de!r}", flush=True)
            script = self._write(project["title"], project.get("offer_description") or "", idea, subject, n,
                                 talk=bool(voice), product_name=(inp.get("product_name") or "").strip()[:120],
                                 product_desc=product_desc)
            script["product"] = product_desc
            _finish(sb, job_id, output=script, gpu_seconds=round(time.time() - t0, 1))

            # Queue one video job per scene. The idempotency key stops duplicates on retry.
            for i, scene in enumerate(script["scenes"]):
                row = {
                    "owner_id": job["owner_id"],
                    "project_id": project_id,
                    "job_type": "video",
                    "idempotency_key": f"{job_id}:scene:{i}",
                    "input": {
                        "script_job_id": job_id,
                        "scene_index": i,
                        "prompt": scene["prompt"],
                        "caption": scene.get("caption", ""),
                        "aspect_ratio": project["aspect_ratio"],
                        # Scenes after the first start from the avatar photo too, so the same
                        # person stays on screen (and lip sync finds their face) in every scene.
                        "image_path": first_image if i == 0 else (avatar or None),
                        "avatar_path": avatar if (i == 0 and product and model_shot) else None,
                        "model_shot": (scene.get("first_frame") or None) if (i == 0 and model_shot) else None,
                        "line": (scene.get("line") or "").strip() if voice else "",
                        "voice": voice,
                        # The last scene ends on the customer's real product photo with the call to action.
                        "end_card": product if (product and i == len(script["scenes"]) - 1) else None,
                        "end_text": (script.get("cta") or scene.get("caption") or "").strip()[:60],
                    },
                }
                res = sb.table("generation_jobs").upsert(
                    row, on_conflict="idempotency_key", ignore_duplicates=True
                ).execute()
                if res.data:
                    make_scene.spawn(res.data[0]["id"])
        except Exception as e:  # noqa: BLE001
            _finish(sb, job_id, error=e, gpu_seconds=round(time.time() - t0, 1))
            _settle_project(sb, project_id)
            raise


# --------------------------------------------------------------------------- image edit


@app.cls(gpu=["H100", "A100-80GB"], image=gpu_image, volumes={MODELS_DIR: models},
         secrets=secrets, timeout=1500, scaledown_window=60, max_containers=2)
class ImageEditor:
    pipe = None

    def _load(self, report):
        """Load lazily inside the call, so a slow load shows up on the job's stage."""
        if self.pipe is not None:
            return
        import torch
        from diffusers import QwenImageEditPipeline

        report("model photo: loading the photo model")
        self.pipe = QwenImageEditPipeline.from_pretrained(EDIT_ID, torch_dtype=torch.bfloat16).to("cuda")

    @modal.method()
    def edit(self, image_png: bytes, prompt: str, job_id: str = "", t0: float = 0.0) -> bytes:
        """Turn a product photo into a photo of a person wearing/using it. The input is
        already padded to the video's aspect ratio, so the output keeps that ratio."""
        import torch
        from PIL import Image

        sb = _sb() if job_id else None
        t0 = t0 or time.time()

        def report(stage):
            if sb:
                _stage(sb, job_id, stage, t0)
            else:
                print(stage, flush=True)

        report(f"model photo: GPU ready ({torch.cuda.get_device_name(0)})")
        self._load(report)
        steps = EDIT_STEPS

        def tick(_pipe, step, _t, kwargs):
            if (step + 1) % 5 == 0 or step == 0:
                report(f"model photo: step {step + 1}/{steps}")
            return kwargs

        img = Image.open(io.BytesIO(image_png)).convert("RGB")
        out = self.pipe(
            image=img, prompt=prompt, negative_prompt=" ", true_cfg_scale=4.0,
            num_inference_steps=steps, generator=torch.Generator("cuda").manual_seed(0),
            callback_on_step_end=tick,
        ).images[0]
        report("model photo: done")
        buf = io.BytesIO()
        out.save(buf, "PNG")
        return buf.getvalue()


# --------------------------------------------------------------------------- video


@app.cls(gpu=["H100", "A100-80GB"], image=gpu_image, volumes={MODELS_DIR: models},
         secrets=secrets, timeout=VIDEO_TIMEOUT, scaledown_window=60, max_containers=2)
class VideoGenerator:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import AutoencoderKLWan, WanImageToVideoPipeline, WanPipeline

        vae = AutoencoderKLWan.from_pretrained(VIDEO_ID, subfolder="vae", torch_dtype=torch.float32)
        self.t2v = WanPipeline.from_pretrained(VIDEO_ID, vae=vae, torch_dtype=torch.bfloat16)
        self.i2v = WanImageToVideoPipeline.from_pipe(self.t2v)
        # 80 GB GPUs hold everything at once, so no CPU offload (offload made a
        # 5-second clip take 30+ minutes). Both pipelines share the same modules.
        # No VAE tiling: in diffusers 0.35 the tiled path skips the Wan 2.2 VAE's
        # patchify step and crashes.
        self.t2v.to("cuda")
        models.commit()

    @staticmethod
    def _deadline(t0: float):
        """Abort a render that would hit Modal's hard timeout, which kills the
        container before the job can be marked failed."""

        def check(_pipe, step, _t, kwargs):
            elapsed = time.time() - t0
            print(f"step {step + 1}/{STEPS} at {elapsed:.0f}s", flush=True)
            if elapsed > RENDER_BUDGET:
                raise TimeoutError(f"Render took longer than {RENDER_BUDGET // 60} minutes")
            return kwargs

        return check

    @modal.method()
    def animate(self, prompt: str, w: int, h: int, image_png: bytes | None, t0: float) -> bytes:
        """Render one ~5 s clip and return it as mp4 bytes."""
        import tempfile

        import torch
        from diffusers.utils import export_to_video
        from PIL import Image

        common = dict(
            prompt=prompt, negative_prompt=NEGATIVE, height=h, width=w,
            num_frames=NUM_FRAMES, guidance_scale=5.0, num_inference_steps=STEPS,
            callback_on_step_end=self._deadline(t0), callback_on_step_end_tensor_inputs=[],
        )
        try:
            if image_png:
                image = Image.open(io.BytesIO(image_png)).convert("RGB")
                frames = self.i2v(image=image, **common).frames[0]
            else:
                frames = self.t2v(**common).frames[0]
            with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
                export_to_video(frames, f.name, fps=FPS)
                return open(f.name, "rb").read()
        finally:
            # Release GPU memory so a failed render cannot starve the next one.
            import gc

            gc.collect()
            torch.cuda.empty_cache()


def _fit(img, w: int, h: int):
    """Fit the whole photo into the frame (nothing cut off). Empty space is filled
    with a blurred, enlarged copy of the photo, like social apps do."""
    from PIL import Image, ImageFilter

    img = img.convert("RGB")
    scale = max(w / img.width, h / img.height)
    bg = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    bg = bg.crop(((bg.width - w) // 2, (bg.height - h) // 2, (bg.width - w) // 2 + w, (bg.height - h) // 2 + h))
    bg = bg.filter(ImageFilter.GaussianBlur(40))
    scale = min(w / img.width, h / img.height)
    fg = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    bg.paste(fg, ((w - fg.width) // 2, (h - fg.height) // 2))
    return bg

def _end_card(raw: bytes, text: str, w: int, h: int) -> bytes:
    """The customer's real product photo, fitted to the frame, with the call to action on it."""
    from PIL import Image, ImageDraw, ImageFont

    img = _fit(Image.open(io.BytesIO(raw)), w, h).convert("RGB")
    if text:
        draw = ImageDraw.Draw(img)
        # A slim bar near the bottom so the product stays visible.
        size = max(24, min(w, h) // 18)
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
        words, lines = text.split(), [""]
        for word in words:  # wrap to the frame width
            trial = (lines[-1] + " " + word).strip()
            if draw.textlength(trial, font=font) > w * 0.86 and lines[-1]:
                lines.append(word)
            else:
                lines[-1] = trial
        box_h = len(lines) * int(size * 1.3) + size
        top = h - box_h - h // 20
        draw.rounded_rectangle([w * 0.04, top, w * 0.96, top + box_h], radius=size // 2, fill=(0, 0, 0))
        for k, line in enumerate(lines):
            tw = draw.textlength(line, font=font)
            draw.text(((w - tw) / 2, top + size // 2 + k * int(size * 1.3)), line, font=font, fill=(255, 215, 0))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()



@app.function(image=gpu_image, secrets=secrets, timeout=VIDEO_TIMEOUT)
def make_scene(job_id: str):
    """Directs one scene on a cheap CPU container: model photo, animation and voice each
    run on their own GPU, which is billed only while it works (not while it waits)."""
    from PIL import Image

    sb = _sb()
    job = _claim(sb, job_id)
    if not job:
        return
    inp, project_id = job["input"], job["project_id"]
    t0 = time.time()
    _stage(sb, job_id, "started", t0)
    photo_note = ""
    try:
        w, h = SIZES.get(inp.get("aspect_ratio", "9:16"), SIZES["9:16"])
        if inp.get("image_path"):
            raw = sb.storage.from_("media").download(inp["image_path"])
            image = _fit(Image.open(io.BytesIO(raw)), w, h)
            if inp.get("model_shot"):
                # Put the product on a person first, then animate that photo.
                instruction = inp["model_shot"]
                if inp.get("avatar_path"):
                    # Avatar on the left, product on the right; ask for one merged photo.
                    face = Image.open(io.BytesIO(sb.storage.from_("media").download(inp["avatar_path"])))
                    half = w // 2
                    board = Image.new("RGB", (w, h), "white")
                    board.paste(_fit(face, half, h), (0, 0))
                    board.paste(_fit(Image.open(io.BytesIO(raw)), w - half, h), (half, 0))
                    image = board
                    instruction = (
                        "The left half shows a person and the right half shows a product. Create ONE "
                        "single full-frame photo (no split screen, no collage) of that same person, "
                        "same face and hair, wearing or using that exact product. " + instruction
                    )
                buf = io.BytesIO()
                image.save(buf, "PNG")
                _stage(sb, job_id, "making the model photo", t0)
                try:
                    # Bounded so the animation and voice still fit in this job's time.
                    call = ImageEditor().edit.spawn(buf.getvalue(), instruction, job_id, t0)
                    try:
                        edited = call.get(timeout=1200)
                    except BaseException:
                        # Stop the photo GPU too, or it keeps billing after we give up.
                        call.cancel()
                        raise
                    image = Image.open(io.BytesIO(edited)).convert("RGB").resize((w, h), Image.LANCZOS)
                    frame_path = f"{job['owner_id']}/{project_id}/generated/{job_id}-frame.png"
                    sb.storage.from_("media").upload(frame_path, edited, {"content-type": "image/png", "upsert": "true"})
                except Exception as ee:  # noqa: BLE001
                    # Fall back to the avatar's own photo (or the product photo) rather than failing.
                    print(f"model photo failed, using the original photo: {ee!r}", flush=True)
                    photo_note = f"failed: {ee!r}"[:300]
                    _stage(sb, job_id, "model photo " + photo_note, t0)
                    fallback = sb.storage.from_("media").download(inp["avatar_path"]) if inp.get("avatar_path") else raw
                    image = _fit(Image.open(io.BytesIO(fallback)), w, h)
        else:
            image = None
        _stage(sb, job_id, "animating", t0)
        png = None
        if image is not None:
            buf = io.BytesIO()
            image.save(buf, "PNG")
            png = buf.getvalue()
        data = VideoGenerator().animate.remote(inp["prompt"], w, h, png, t0)

        voice_mode = None
        if inp.get("voice") and inp.get("line"):
            # Give the avatar a voice and sync their lips. If anything goes wrong the
            # silent clip is still delivered rather than failing the whole scene.
            _stage(sb, job_id, "adding the voice", t0)
            try:
                # Leave time to save the clip before this container's own timeout.
                wait = max(30, VIDEO_TIMEOUT - (time.time() - t0) - 240)
                talked = Talker().speak.spawn(data, inp["line"], inp["voice"]).get(timeout=wait)
                data, voice_mode = talked["video"], talked["mode"]
            except Exception as te:  # noqa: BLE001
                print(f"voice step failed, keeping silent clip: {te!r}", flush=True)
                voice_mode = "failed"

        if inp.get("end_card"):
            _stage(sb, job_id, "adding the product end card", t0)
            try:
                card = _end_card(sb.storage.from_("media").download(inp["end_card"]),
                                      inp.get("end_text") or "", w, h)
                data = _append_card(data, card, w, h)
            except Exception as ce:  # noqa: BLE001
                print(f"end card failed, keeping the clip without it: {ce!r}", flush=True)

        path = f"{job['owner_id']}/{project_id}/generated/{job_id}.mp4"
        sb.storage.from_("media").upload(path, data, {"content-type": "video/mp4", "upsert": "true"})
        asset = sb.table("assets").insert({
            "owner_id": job["owner_id"],
            "project_id": project_id,
            "kind": "generated_clip",
            "storage_path": path,
            "file_name": f"Scene {inp.get('scene_index', 0) + 1}.mp4",
            "mime_type": "video/mp4",
            "size_bytes": len(data),
        }).execute().data[0]
        _finish(sb, job_id, output={"asset_id": asset["id"], "storage_path": path, "voice": voice_mode,
                                             "model_photo": photo_note or None},
                gpu_seconds=round(time.time() - t0, 1))
    except Exception as e:  # noqa: BLE001
        _finish(sb, job_id, error=e, gpu_seconds=round(time.time() - t0, 1))
        raise
    finally:
        _settle_project(sb, project_id)




# --------------------------------------------------------------------------- talking avatar


# Lip sync fits in 24 GB, so it runs on mid-range GPUs only (never the pricey A100/H100),
# and the GPU shuts off 20 s after the last line instead of idling for a minute.
@app.cls(gpu=["L40S", "A10G", "L4"], image=talk_image, volumes={MODELS_DIR: models},
         timeout=2400, scaledown_window=20, max_containers=2)
class Talker:
    @modal.enter()
    def load(self):
        import torch
        from huggingface_hub import hf_hub_download

        # LatentSync isn't pip-installable: import it from its repo folder, which is also where
        # it loads its config files from (relative paths).
        import sys

        if LS_DIR not in sys.path:
            sys.path.insert(0, LS_DIR)
        os.chdir(LS_DIR)
        ckpt = f"{MODELS_DIR}/latentsync"
        for name in ("latentsync_unet.pt", "whisper/tiny.pt"):
            hf_hub_download("ByteDance/LatentSync-1.6", name, local_dir=ckpt)
        os.makedirs(f"{ckpt}/auxiliary", exist_ok=True)  # insightface face models land here
        if not os.path.islink(f"{LS_DIR}/checkpoints"):
            os.symlink(ckpt, f"{LS_DIR}/checkpoints")

        from diffusers import AutoencoderKL, DDIMScheduler
        from kokoro import KPipeline
        from omegaconf import OmegaConf

        from latentsync.models.unet import UNet3DConditionModel
        from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
        from latentsync.whisper.audio2feature import Audio2Feature

        self.config = OmegaConf.load("configs/unet/stage2_512.yaml")
        self.dtype = torch.float16
        audio_encoder = Audio2Feature(
            model_path="checkpoints/whisper/tiny.pt", device="cuda",
            num_frames=self.config.data.num_frames, audio_feat_length=self.config.data.audio_feat_length,
        )
        vae = AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse", torch_dtype=self.dtype)
        vae.config.scaling_factor = 0.18215
        vae.config.shift_factor = 0
        unet, _ = UNet3DConditionModel.from_pretrained(
            OmegaConf.to_container(self.config.model), "checkpoints/latentsync_unet.pt", device="cpu"
        )
        self.lipsync = LipsyncPipeline(
            vae=vae, audio_encoder=audio_encoder, unet=unet.to(dtype=self.dtype),
            scheduler=DDIMScheduler.from_pretrained("configs"),
        ).to("cuda")
        self.tts = {"a": KPipeline(lang_code="a"), "b": KPipeline(lang_code="b")}
        models.commit()

    def _say(self, line: str, voice: str):
        """Speak the line (24 kHz mono). Speed up a little if it would overrun the clip."""
        import numpy as np

        pipe = self.tts.get(voice[0], self.tts["a"])

        def synth(speed):
            parts = [np.asarray(a, dtype=np.float32) for _, _, a in pipe(line, voice=voice, speed=speed)]
            return np.concatenate(parts) if parts else np.zeros(1, np.float32)

        audio = synth(1.0)
        limit = TALK_SECONDS - 0.4
        if len(audio) / 24000 > limit:
            audio = synth(min(1.35, len(audio) / 24000 / limit))
        return audio

    @modal.method()
    def selftest(self) -> dict:
        t0 = time.time()
        clip = open(f"{LS_DIR}/assets/demo1_video.mp4", "rb").read()
        res = self.speak.local(clip, "Hey! I found the perfect gift, and you need one too.", "af_heart")
        return {"mode": res["mode"], "bytes": len(res["video"]), "seconds": round(time.time() - t0, 1)}

    @modal.method()
    def speak(self, video_mp4: bytes, line: str, voice: str) -> dict:
        import subprocess
        import tempfile

        import numpy as np
        import soundfile as sf

        os.chdir(LS_DIR)
        audio = self._say(line, voice)
        # Start speaking a beat in, and pad with silence to the full clip length.
        lead = np.zeros(int(0.25 * 24000), np.float32)
        audio = np.concatenate([lead, audio])
        total = int(TALK_SECONDS * 24000)
        audio = np.pad(audio, (0, max(0, total - len(audio))))[:total]

        with tempfile.TemporaryDirectory() as tmp:
            src, wav = f"{tmp}/in.mp4", f"{tmp}/voice.wav"
            src25, out = f"{tmp}/in25.mp4", f"{tmp}/out.mp4"
            open(src, "wb").write(video_mp4)
            sf.write(wav, audio, 24000)
            # LatentSync works at 25 fps.
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-r", "25", "-c:v", "libx264",
                            "-crf", "16", "-pix_fmt", "yuv420p", src25], check=True)
            try:
                self.lipsync(
                    video_path=src25, audio_path=wav, video_out_path=out,
                    num_frames=self.config.data.num_frames, num_inference_steps=LIPSYNC_STEPS, guidance_scale=1.5,
                    weight_dtype=self.dtype, width=self.config.data.resolution,
                    height=self.config.data.resolution, mask_image_path=self.config.data.mask_image_path,
                    temp_dir=f"{tmp}/ls",
                )
                return {"video": open(out, "rb").read(), "mode": "lipsync"}
            except RuntimeError as e:
                if "Face not detected" not in str(e):
                    raise
                # No face on screen (e.g. a product shot): use the line as a voice-over.
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-i", wav, "-c:v", "copy",
                                "-c:a", "aac", "-b:a", "192k", "-shortest", out], check=True)
                return {"video": open(out, "rb").read(), "mode": "voiceover"}


@app.function(image=talk_image, volumes={MODELS_DIR: models}, timeout=3600)
def prefetch() -> list[str]:
    """Download every model's weights into the shared volume (CPU only), so the first
    real video doesn't spend its GPU time and time limit on downloads. Fast when cached."""
    from huggingface_hub import hf_hub_download, snapshot_download

    done = []
    for repo in (LLM_ID, VIDEO_ID, EDIT_ID, "stabilityai/sd-vae-ft-mse"):
        t = time.time()
        snapshot_download(repo)
        models.commit()
        done.append(f"{repo}: {time.time() - t:.0f}s")
    for name in ("latentsync_unet.pt", "whisper/tiny.pt"):
        hf_hub_download("ByteDance/LatentSync-1.6", name, local_dir=f"{MODELS_DIR}/latentsync")
    models.commit()
    done.append("LatentSync-1.6: ok")
    return done


@app.local_entrypoint()
def warm_models():
    """`modal run worker/modal_app.py::warm_models`"""
    print(prefetch.remote())


VOICE_IDS = ["af_heart", "af_bella", "am_michael", "am_fenrir", "bf_emma", "bm_george"]
SAMPLE_LINE = "Hi! This is the voice I'd use for your video. Let me show you why you'll love this."


@app.function(image=talk_image, volumes={MODELS_DIR: models}, secrets=secrets, timeout=900)
def voice_samples() -> list[str]:
    """Render a short preview of each voice (CPU) into the public voice-samples bucket."""
    import subprocess, tempfile, urllib.request
    import numpy as np, soundfile as sf
    from kokoro import KPipeline

    pipes = {}
    base, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    done = []
    for v in VOICE_IDS:
        try:  # already rendered? (runs after every deploy, so skip the ones that exist)
            urllib.request.urlopen(f"{base}/storage/v1/object/public/voice-samples/{v}.mp3", timeout=20).read(1)
            done.append(f"{v}: exists")
            continue
        except Exception:
            pass
        if v[0] not in pipes:
            pipes[v[0]] = KPipeline(lang_code=v[0])
        audio = np.concatenate([np.asarray(a, dtype=np.float32) for _, _, a in pipes[v[0]](SAMPLE_LINE, voice=v)])
        with tempfile.TemporaryDirectory() as d:
            sf.write(f"{d}/v.wav", audio, 24000)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{d}/v.wav", "-b:a", "64k", f"{d}/v.mp3"], check=True)
            data = open(f"{d}/v.mp3", "rb").read()
        req = urllib.request.Request(f"{base}/storage/v1/object/voice-samples/{v}.mp3", data=data, method="POST",
                                     headers={"Authorization": f"Bearer {key}", "apikey": key,
                                              "Content-Type": "audio/mpeg", "x-upsert": "true"})
        urllib.request.urlopen(req, timeout=60).read()
        done.append(f"{v}: {len(audio) / 24000:.1f}s")
    models.commit()
    return done


@app.local_entrypoint()
def make_voice_samples():
    """`modal run worker/modal_app.py::make_voice_samples`"""
    print(voice_samples.remote())


@app.local_entrypoint()
def talk_smoke():
    """Self-test: voice + lip-sync on LatentSync's own demo clip. `modal run worker/modal_app.py::talk_smoke`"""
    print(Talker().selftest.remote())


# --------------------------------------------------------------------------- web entry point


@app.function(image=web_image, secrets=secrets)
@modal.fastapi_endpoint(method="POST")
async def submit(request: Request):
    """Called by the web app with {"job_id": ...}. Auth: Bearer WORKER_SHARED_SECRET."""
    import hmac

    auth = request.headers.get("authorization", "")
    expected = f"Bearer {os.environ['WORKER_SHARED_SECRET']}"
    if not hmac.compare_digest(auth.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")
    body = await request.json()
    job_id = str(body.get("job_id", ""))
    job = (
        _sb().table("generation_jobs").select("id, job_type, status")
        .eq("id", job_id).maybe_single().execute()
    )
    if not job or not job.data or job.data["status"] != "queued":
        raise HTTPException(status_code=409, detail="job not found or not queued")
    if job.data["job_type"] == "script":
        ScriptWriter().run.spawn(job_id)
    elif job.data["job_type"] == "video":
        make_scene.spawn(job_id)
    else:
        raise HTTPException(status_code=400, detail="unsupported job type")
    return {"ok": True}
