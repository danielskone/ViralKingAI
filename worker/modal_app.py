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
VIDEO_TIMEOUT = 2400  # seconds Modal lets one clip run
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

    def _write(self, title: str, offer: str, idea: str, subject: str, n: int) -> dict:
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
        user = f"""Project: "{title}". Business / offer: "{offer or title}".
Customer's idea for the video: "{idea or 'not given; choose a strong, scroll-stopping concept for this offer'}".
{photo_rule}

Write {n} scene(s) for a short social media ad that follows the customer's idea closely.
For each scene give:
- "prompt": 70-110 words, in the style of this example: "{example}"
- "caption": on-screen text for that scene, max 8 words.
Also give "hook" (max 8 words) and "cta" (max 6 words).
JSON shape: {{"hook": str, "cta": str, "scenes": [{{"prompt": str, "caption": str, "first_frame": str (scene 1 only, when asked)}}]}}"""
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
            script = self._write(project["title"], project.get("offer_description") or "", idea, subject, n)
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
         timeout=1500, scaledown_window=60, max_containers=2)
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
                    edited = ImageEditor().edit.remote(buf.getvalue(), instruction)
                    image = Image.open(io.BytesIO(edited)).convert("RGB").resize((w, h), Image.LANCZOS)
                    frame_path = f"{job['owner_id']}/{project_id}/generated/{job_id}-frame.png"
                    sb.storage.from_("media").upload(frame_path, edited, {"content-type": "image/png", "upsert": "true"})
                frames = self.i2v(image=image, **common).frames[0]
            else:
                frames = self.t2v(**common).frames[0]

            with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
                export_to_video(frames, f.name, fps=FPS)
                data = open(f.name, "rb").read()

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
            _finish(sb, job_id, output={"asset_id": asset["id"], "storage_path": path},
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
