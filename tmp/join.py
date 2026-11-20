# Joins the finished scenes of two projects into their full videos (temporary).
import sys

sys.path.insert(0, "worker")
import modal_app as m  # noqa: E402

app = m.app
PROJECTS = ["48f136ab-22eb-41c0-8a94-beefaad95189", "5a9b7064-8a48-4e4e-b96e-70570d3c29d6"]


@app.function(image=m.gpu_image.add_local_python_source("modal_app"), secrets=[m.modal.Secret.from_name("viralking-secrets")], timeout=900)
def join(pid: str) -> str:
    sb = m._sb()
    m._settle_project(sb, pid)
    rows = sb.table("assets").select("storage_path,size_bytes").eq("project_id", pid).eq("kind", "export").execute().data
    return str(rows)


@app.local_entrypoint()
def main():
    for p in PROJECTS:
        print("JOINED", p, join.remote(p), flush=True)
