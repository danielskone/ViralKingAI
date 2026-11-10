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
MODELS_DIR = "/models"

# Wan 2.2 TI2V-5B native resolution is 1280x704 (or 704x1280), 24 fps.
SIZES = {"9:16": (704, 1280), "16:9": (1280, 704), "1:1": (960, 960)}
FPS = 24
NUM_FRAMES = 121  # ~5 seconds; must be 4k+1
STEPS = int(os.environ.get("WAN_STEPS", "40"))
NEGATIVE = (
    "blurry, low quality, distorted, deformed hands, extra fingers, watermark, text artifacts, "
    "jpeg artifacts, flicker, static frame, oversaturated, ugly, disfigured"
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

    def _write(self, title: str, offer: str, has_image: bool, n: int) -> dict:
        system = (
            "You are a short-form social video director for small businesses. "
            "Reply with JSON only, no prose."
        )
        user = f"""Business video: "{title}".
Offer / message: "{offer or title}".
{"The customer uploaded a product or business photo; scene 1 animates that photo, so describe motion for it." if has_image else "No photo was uploaded; describe every scene fully."}

Write {n} scenes for a 15-second vertical promo. For each scene give:
- "prompt": a vivid, literal visual description for an AI video model (subject, setting, camera movement, lighting, style). 40-70 words. No on-screen text, no logos.
- "caption": the on-screen text for that scene, max 8 words.
Also give "hook" (first line to grab attention, max 8 words) and "cta" (call to action, max 6 words).
JSON shape: {{"hook": str, "cta": str, "scenes": [{{"prompt": str, "caption": str}}]}}"""
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        ids = self.tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt").to("cuda")
        out = self.model.generate(ids, max_new_tokens=900, temperature=0.8, top_p=0.9, do_sample=True)
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
            script = self._write(project["title"], project.get("offer_description") or "", bool(images), n)
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
                        "image_path": images[0]["storage_path"] if (i == 0 and images) else None,
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


# --------------------------------------------------------------------------- video


@app.cls(gpu=["L40S", "A100-80GB"], image=gpu_image, volumes={MODELS_DIR: models},
         secrets=secrets, timeout=1800, scaledown_window=120, max_containers=2)
class VideoGenerator:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import AutoencoderKLWan, WanImageToVideoPipeline, WanPipeline

        vae = AutoencoderKLWan.from_pretrained(VIDEO_ID, subfolder="vae", torch_dtype=torch.float32)
        self.t2v = WanPipeline.from_pretrained(VIDEO_ID, vae=vae, torch_dtype=torch.bfloat16)
        self.i2v = WanImageToVideoPipeline.from_pipe(self.t2v)
        # Keep only the model that is running on the GPU (the 11 GB text encoder is
        # parked in RAM while the video model works). Both pipelines share the same
        # modules, so the offload hooks cover both. No VAE tiling: in diffusers 0.35
        # the tiled path skips the Wan 2.2 VAE's patchify step and crashes.
        self.t2v.enable_model_cpu_offload()
        models.commit()

    @staticmethod
    def _fit(img, w: int, h: int):
        """Center-crop and resize the photo to the exact output frame."""
        from PIL import Image

        img = img.convert("RGB")
        src_ratio, dst_ratio = img.width / img.height, w / h
        if src_ratio > dst_ratio:
            nw = int(img.height * dst_ratio)
            x = (img.width - nw) // 2
            img = img.crop((x, 0, x + nw, img.height))
        else:
            nh = int(img.width / dst_ratio)
            y = (img.height - nh) // 2
            img = img.crop((0, y, img.width, y + nh))
        return img.resize((w, h), Image.LANCZOS)

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
            )
            if inp.get("image_path"):
                raw = sb.storage.from_("media").download(inp["image_path"])
                image = self._fit(Image.open(io.BytesIO(raw)), w, h)
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
