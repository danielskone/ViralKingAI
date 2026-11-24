# Temporary: run the unmerged caption code as a Modal app and make the 10 ads, waiting until done.
import sys
import time

sys.path.insert(0, "worker")
import modal_app as m  # noqa: E402

app = m.app
JOBS = ["22784d19-ecfe-4727-825d-4486c7c14b32", "ebec3724-52fd-4946-95e8-270acf535813",
        "03dd2d5f-9189-49be-a05a-2bb0688d3a9f", "c3956ef9-caf5-4b0a-a80a-97b434a58407",
        "df4e0881-509d-4d18-a9ad-f5dd21f0fbbb", "ddb350e2-a5c2-452e-9c07-2747433e92d8",
        "ce6c309e-524d-4f15-b98e-d3f20fcd9a32", "4cd22c43-3661-4fe7-8df3-938ae99facf1"]


@app.function(image=m.web_image.add_local_python_source("modal_app"), secrets=m.secrets)
def busy() -> int:
    sb = m._sb()
    pids = [r["project_id"] for r in sb.table("generation_jobs").select("project_id").in_("id", JOBS).execute().data]
    return len(sb.table("projects").select("id").in_("id", pids).eq("status", "generating").execute().data)


@app.local_entrypoint()
def main():
    for j in JOBS:
        m.ScriptWriter().run.spawn(j)
    t = time.time()
    time.sleep(240)
    while time.time() - t < 45 * 60:
        n = busy.remote()
        print(round(time.time() - t), "projects still generating:", n, flush=True)
        if n == 0:
            break
        time.sleep(30)
    print("DONE", flush=True)
