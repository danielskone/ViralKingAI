# Temporary: start 5 hand-made jobs on the deployed worker.
import modal
JOBS = ["495263d2-0638-4ac1-9084-38f3e8ef0970", "0450fa8d-2a4c-44dd-9f55-8d802c9b1456", "602c4084-2d45-4b09-99f8-9982c16a985a",
        "9bb491e2-7ec5-4610-8316-7eb319b00a8a", "d5274183-8a99-4ba0-9363-a82cba492ff1"]
w = modal.Cls.from_name("viralking-ai", "ScriptWriter")()
for j in JOBS:
    print("spawned", j, w.run.spawn(j).object_id, flush=True)
