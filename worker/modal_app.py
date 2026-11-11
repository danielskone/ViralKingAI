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
LLM_ID = "Qwen/Qwen2.5-7B-Instruct"
VIDEO_ID = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
EDIT_ID = "Qwen/Qwen-Image-Edit"  # Apache 2.0; puts the product on a model for the first frame
MODELS_DIR = "/models"

# Wan 2.2 TI2V-5B native resolution is 1280x704 (or 704x1280), 24 fps.
SIZES = {"9:16": (704, 1280), "16:9": (1280, 704), "1:1": (960, 960)}
FPS = 24
NUM_FRAMES = 121  # ~5 seconds; must be 4k+1
STEPS = int(os.environ.get("WAN_STEPS", "40"))
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
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.7.1",
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


# --------------------------------------------------------------------------- script


@app.cls(gpu=["L4", "A10G", "L40S"], image=gpu_image, volumes={MODELS_DIR: models}, secrets=secrets,
         timeout=600, scaledown_window=120)
class ScriptWriter:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.tok = AutoTokenizer.from_pretrained(LLM_ID)
        self.model = AutoModelForCausalLM.from_pretrained(
            LLM_ID, torch_dtype=torch.bfloat16, device_map="cuda"
        )
        models.commit()

    def _write(self, title: str, offer: str, idea: str, subject: str, n: int, talk: bool = False,
               product_name: str = "") -> dict:
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
            )
        elif subject == "avatar":
            photo_rule = (
                "Scene 1 starts from the customer's photo of a person (their avatar). Its prompt must "
                "describe that person performing the idea (action, expression, camera move, light); "
                "keep their look unchanged."
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
            f"The LAST scene's line must end with a clear call to action that sells {thing}: say the "
            "product by name (or \"this\" if no real name is given) and tell viewers what to do now, e.g. "
            "\"Tap the link and grab yours today!\" or \"Get yours before they sell out!\". "
            "With only 1 scene, that one line is a quick hook plus the call to action."
            if sells else
            "The LAST scene's line ends with a clear call to action (follow, comment, or tap the link)."
        )
        if talk and subject != "product":
            talk_rule = (
                "The person TALKS to the camera in every scene, like a real UGC creator. In each prompt, "
                "frame them in a medium close-up facing the camera, speaking with natural expressions and "
                "gentle head movement, mouth clearly visible, nothing covering the face. For each scene also "
                "write \"line\": exactly what they say out loud, 8-12 words, first person, casual and "
                "convincing." + (" Every line is about the product: what it is, a benefit or detail they love, "
                "and why the viewer needs it, while they hold, wear or point to it on camera."
                if subject in ("product_model", "product_avatar") else "") + " Scene 1 opens with a hook. " + cta_rule
            )
        elif talk:
            talk_rule = (
                "A narrator speaks over the video. For each scene also write \"line\": the voice-over for "
                "that shot, 8-12 words, warm and persuasive. Scene 1 opens with a hook. " + cta_rule
            )
        else:
            talk_rule = ""
        name_line = (f'Product name: "{product_name}" (if this looks like a file name such as IMG_1234 or '
                     '"Product from amazon.com", it is not a real name: call it "this" instead).'
                     if product_name else "")
        user = f"""Project: "{title}". Business / offer: "{offer or title}".
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
Also give "hook" (max 8 words) and "cta" (max 6 words): a call to action that names the product
when a real name is known, e.g. "Shop the {{product}} now" or "Tap the link to get yours".
JSON shape: {{"hook": str, "cta": str, "scenes": [{{"prompt": str, "caption": str, "line": str (when asked), "first_frame": str (scene 1 only, when asked)}}]}}"""
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        ids = self.tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt").to("cuda")
        out = self.model.generate(ids, max_new_tokens=1600, temperature=0.8, top_p=0.9, do_sample=True)
        text = self.tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True)
        match = re.search(r"\{.*\}", text, re.S)
        data = json.loads(match.group(0) if match else text)
        scenes = [s for s in data.get("scenes", []) if s.get("prompt")][:n]
        if not scenes:
            raise ValueError("Script model returned no scenes")
        return {"hook": data.get("hook", ""), "cta": data.get("cta", ""), "scenes": scenes}

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
            script = self._write(project["title"], project.get("offer_description") or "", idea, subject, n,
                                 talk=bool(voice), product_name=(inp.get("product_name") or "").strip()[:120])
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
                        "image_path": first_image if i == 0 else None,
                        "avatar_path": avatar if (i == 0 and product and model_shot) else None,
                        "model_shot": (scene.get("first_frame") or None) if (i == 0 and model_shot) else None,
                        "line": (scene.get("line") or "").strip() if voice else "",
                        "voice": voice,
                    },
                }
                res = sb.table("generation_jobs").upsert(
                    row, on_conflict="idempotency_key", ignore_duplicates=True
                ).execute()
                if res.data:
                    VideoGenerator().run.spawn(res.data[0]["id"])
        except Exception as e:  # noqa: BLE001
            _finish(sb, job_id, error=e, gpu_seconds=round(time.time() - t0, 1))
            _settle_project(sb, project_id)
            raise


# --------------------------------------------------------------------------- image edit


@app.cls(gpu=["H100", "A100-80GB"], image=gpu_image, volumes={MODELS_DIR: models},
         timeout=2400, scaledown_window=60, max_containers=2)
class ImageEditor:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImageEditPipeline

        self.pipe = QwenImageEditPipeline.from_pretrained(EDIT_ID, torch_dtype=torch.bfloat16).to("cuda")
        models.commit()

    @modal.method()
    def edit(self, image_png: bytes, prompt: str) -> bytes:
        """Turn a product photo into a photo of a person wearing/using it. The input is
        already padded to the video's aspect ratio, so the output keeps that ratio."""
        import torch
        from PIL import Image

        img = Image.open(io.BytesIO(image_png)).convert("RGB")
        out = self.pipe(
            image=img, prompt=prompt, negative_prompt=" ", true_cfg_scale=4.0,
            num_inference_steps=40, generator=torch.Generator("cuda").manual_seed(0),
        ).images[0]
        buf = io.BytesIO()
        out.save(buf, "PNG")
        return buf.getvalue()


# --------------------------------------------------------------------------- video


@app.cls(gpu=["H100", "A100-80GB"], image=gpu_image, volumes={MODELS_DIR: models},
         secrets=secrets, timeout=VIDEO_TIMEOUT, scaledown_window=120, max_containers=2)
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

    @staticmethod
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

    @modal.method()
    def run(self, job_id: str):
        import tempfile

        from diffusers.utils import export_to_video
        from PIL import Image

        sb = _sb()
        job = _claim(sb, job_id)
        if not job:
            return
        inp, project_id = job["input"], job["project_id"]
        t0 = time.time()
        _stage(sb, job_id, "started", t0)
        try:
            w, h = SIZES.get(inp.get("aspect_ratio", "9:16"), SIZES["9:16"])
            common = dict(
                prompt=inp["prompt"], negative_prompt=NEGATIVE, height=h, width=w,
                num_frames=NUM_FRAMES, guidance_scale=5.0, num_inference_steps=STEPS,
                callback_on_step_end=self._deadline(t0), callback_on_step_end_tensor_inputs=[],
            )
            if inp.get("image_path"):
                raw = sb.storage.from_("media").download(inp["image_path"])
                image = self._fit(Image.open(io.BytesIO(raw)), w, h)
                if inp.get("model_shot"):
                    # Put the product on a person first, then animate that photo.
                    instruction = inp["model_shot"]
                    if inp.get("avatar_path"):
                        # Avatar on the left, product on the right; ask for one merged photo.
                        face = Image.open(io.BytesIO(sb.storage.from_("media").download(inp["avatar_path"])))
                        half = w // 2
                        board = Image.new("RGB", (w, h), "white")
                        board.paste(self._fit(face, half, h), (0, 0))
                        board.paste(self._fit(Image.open(io.BytesIO(raw)), w - half, h), (half, 0))
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
                        edited = ImageEditor().edit.spawn(buf.getvalue(), instruction).get(timeout=1200)
                        image = Image.open(io.BytesIO(edited)).convert("RGB").resize((w, h), Image.LANCZOS)
                        frame_path = f"{job['owner_id']}/{project_id}/generated/{job_id}-frame.png"
                        sb.storage.from_("media").upload(frame_path, edited, {"content-type": "image/png", "upsert": "true"})
                    except Exception as ee:  # noqa: BLE001
                        # Fall back to the avatar's own photo (or the product photo) rather than failing.
                        print(f"model photo failed, using the original photo: {ee!r}", flush=True)
                        fallback = sb.storage.from_("media").download(inp["avatar_path"]) if inp.get("avatar_path") else raw
                        image = self._fit(Image.open(io.BytesIO(fallback)), w, h)
                _stage(sb, job_id, "animating", t0)
                frames = self.i2v(image=image, **common).frames[0]
            else:
                _stage(sb, job_id, "animating", t0)
                frames = self.t2v(**common).frames[0]

            with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
                export_to_video(frames, f.name, fps=FPS)
                data = open(f.name, "rb").read()

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
            _finish(sb, job_id, output={"asset_id": asset["id"], "storage_path": path, "voice": voice_mode},
                    gpu_seconds=round(time.time() - t0, 1))
        except Exception as e:  # noqa: BLE001
            _finish(sb, job_id, error=e, gpu_seconds=round(time.time() - t0, 1))
            raise
        finally:
            _settle_project(sb, project_id)
            # Release GPU memory so a failed job cannot starve the next one.
            import gc

            import torch

            gc.collect()
            torch.cuda.empty_cache()


# --------------------------------------------------------------------------- talking avatar


@app.cls(gpu=["L40S", "A100-80GB", "H100"], image=talk_image, volumes={MODELS_DIR: models},
         timeout=2400, scaledown_window=60, max_containers=2)
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
                    num_frames=self.config.data.num_frames, num_inference_steps=20, guidance_scale=1.5,
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
        VideoGenerator().run.spawn(job_id)
    else:
        raise HTTPException(status_code=400, detail="unsupported job type")
    return {"ok": True}
