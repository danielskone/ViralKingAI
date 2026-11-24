# Temporary: fetch a Shopify product, upload its main photo to storage, print the details.
import modal

app = modal.App("tmp-lights")
img = modal.Image.debian_slim().pip_install("supabase==2.22.4", "requests")
URL = "https://ncnorthpole.com/products/12-pack-7ft-battery-operated-led-fairy-lights-for-xmas-decoration.json"
PATH = "fa7a051c-da31-4087-9f48-19f8aaae9d39/library/7c1e2b9a-4f3d-4c55-9a51-fairy-lights.jpg"


@app.function(image=img, secrets=[modal.Secret.from_name("viralking-secrets")])
def run() -> str:
    import os
    import re

    import requests
    from supabase import create_client

    p = requests.get(URL, timeout=30, headers={"User-Agent": "Mozilla/5.0"}).json()["product"]
    lines = [p["title"], re.sub(r"<[^>]+>", " ", p.get("body_html") or "")[:2500]]
    lines += [f"VARIANT {v['title']} {v['price']} {v.get('compare_at_price')}" for v in p["variants"][:8]]
    lines += [f"IMAGE {i['src']} {i['width']}x{i['height']}" for i in p["images"][:10]]
    src = p["images"][0]["src"]
    data = requests.get(src, timeout=60).content
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    sb.storage.from_("media").upload(PATH, data, {"content-type": "image/jpeg", "upsert": "true"})
    lines.append(f"UPLOADED {len(data)} bytes from {src}")
    return "\n".join(lines)


@app.local_entrypoint()
def main():
    print(run.remote())
