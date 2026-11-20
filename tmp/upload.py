import modal
app = modal.App("tmp-upload")
img = modal.Image.debian_slim().pip_install("supabase==2.22.4")
PATH = "fa7a051c-da31-4087-9f48-19f8aaae9d39/library/3e9fe42a-24c9-449e-b7e9-7a06d5c20ed0-kids-art-frame.jpg"

@app.function(image=img, secrets=[modal.Secret.from_name("viralking-secrets")])
def up(data: bytes):
    import os
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    sb.storage.from_("media").upload(PATH, data, {"content-type": "image/jpeg", "upsert": "true"})
    print("uploaded", len(data))

@app.local_entrypoint()
def main():
    up.remote(open("tmp/frame.jpg", "rb").read())
