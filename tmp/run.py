# Temporary: run the unmerged caption code as a Modal app and make the 10 ads, waiting until done.
import sys
import time

sys.path.insert(0, "worker")
import modal_app as m  # noqa: E402

app = m.app
JOBS = ["f23cfcf8-db21-4518-a183-fd8c7ea48b0a", "78d13014-4b47-4db1-a442-c75a15dda8a2",
        "fb9f799d-c3e2-4003-9d14-b8409c862c30", "99140b4e-8d20-4908-bf1c-e4b71f653fe2",
        "f9c78215-fc39-4651-84bd-f987bf7b8332", "d20ca4d8-597d-4663-9eed-ea2ff0b1778f",
        "3406316c-76df-4619-b024-04741fc2d560", "4afce3d6-f29d-430f-b4e2-5c271f345090",
        "7baea8f5-749a-4eab-b718-d4c0226edac6", "5a617d51-3a28-4025-97c0-abec44ed26ab"]


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
