# Temporary: upload the fairy lights photo, then start the 10 ad videos.
import modal

app = modal.App("tmp-lights")
img = modal.Image.debian_slim().pip_install("supabase==2.22.4")
PATH = "fa7a051c-da31-4087-9f48-19f8aaae9d39/library/5d2c8e41-9b7a-4c1f-8e2d-fairy-lights-strand.jpg"
JOBS = ["7faee304-520b-49e9-abcd-5887cefc6b6f", "4ba98112-4bc0-468b-a79f-d592c0749141",
        "1551f924-6d47-4e7e-87d9-ad75384f86d8", "73078b3e-2ec3-4e97-9ed9-b274ae701c99",
        "7abc593c-652f-4ea0-a637-11da3e8f71f0", "2a417072-6193-4579-b156-10dd25dd38b8",
        "b0a37437-58a7-4c50-8317-13ae5664a43c", "230facf3-9b0a-4d9b-a05e-a23105070eec",
        "14f7a0dc-d4d1-45c5-8b93-6261749bf944", "5842b16b-ffbe-416d-8634-87df80b80d7e"]


@app.function(image=img, secrets=[modal.Secret.from_name("viralking-secrets")])
def up(data: bytes):
    import os

    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    sb.storage.from_("media").upload(PATH, data, {"content-type": "image/jpeg", "upsert": "true"})
    print("uploaded", len(data))


@app.local_entrypoint()
def main():
    up.remote(open("tmp/coil.jpg", "rb").read())
    writer = modal.Cls.from_name("viralking-ai", "ScriptWriter")()
    for j in JOBS:
        writer.run.spawn(j)
    print("started", len(JOBS))
