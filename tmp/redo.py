# Runs the unmerged worker code as a temporary Modal app to redo two videos, waiting until they finish.
import sys
import time

sys.path.insert(0, "worker")
import modal_app as m  # noqa: E402

app = m.app
JOBS = ["f8d432d1-45f1-4f52-9b5b-ca35bb9dd333", "f64afcd2-17a6-4db4-b426-35027b30247b"]


@app.function(image=m.web_image, secrets=[m.modal.Secret.from_name("viralking-secrets")])
def status() -> list:
    sb = m._sb()
    scripts = sb.table("generation_jobs").select("id,status,output").in_("id", JOBS).execute().data
    out = [(s["id"][:8], "script", s["status"]) for s in scripts]
    for s in scripts:
        rows = (sb.table("generation_jobs").select("id,job_type,status,input")
                .contains("input", {"script_job_id": s["id"]}).execute().data)
        out += [(r["id"][:8], r["job_type"], r["status"], (r["input"] or {}).get("line")) for r in rows]
    return out


@app.local_entrypoint()
def main():
    for j in JOBS:
        m.ScriptWriter().run.spawn(j)
    t = time.time()
    while time.time() - t < 40 * 60:
        time.sleep(30)
        rows = status.remote()
        print(round(time.time() - t), rows, flush=True)
        if len(rows) > 2 and all(r[2] in ("succeeded", "failed") for r in rows):
            busy = [r for r in rows if r[1] != "script"]
            if len(busy) >= 3:
                break
    print("DONE", status.remote())
