# Temporary: start 5 hand-made jobs on the deployed worker.
import modal
JOBS = ["f59cfcfc-6667-4cc5-9af8-4c793d122d8a", "543e187f-2f31-4f19-ba54-159a55bdd9ea", "4c3ba0cf-14d1-4466-8b0d-52b11695e997",
        "5fd6d699-9585-4c95-8a16-1bf4b23a96e4", "a9b77204-1584-4030-b08f-663d681c892a"]
w = modal.Cls.from_name("viralking-ai", "ScriptWriter")()
for j in JOBS:
    print("spawned", j, w.run.spawn(j).object_id, flush=True)
