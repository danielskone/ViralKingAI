"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { latestRun } from "@/lib/jobs";

type Job = {
  id: string;
  job_type: string;
  status: string;
  input: { scene_index?: number; caption?: string; script_job_id?: string } | null;
  error: string | null;
  created_at: string;
};

const LABEL: Record<string, string> = {
  queued: "Waiting for a GPU",
  running: "Working",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function JobsPanel({ projectId, initial }: { projectId: string; initial: Job[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>(initial);
  const lastDone = useRef(initial.filter((j) => j.status === "succeeded").length);
  const active = latestRun(jobs).some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (!active) return;
    const supabase = createClient();
    const t = setInterval(async () => {
      const { data } = await supabase
        .from("generation_jobs")
        .select("id, job_type, status, input, error, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!data) return;
      setJobs(data as Job[]);
      const done = data.filter((j) => j.status === "succeeded").length;
      if (done !== lastDone.current) {
        lastDone.current = done;
        router.refresh(); // pull in new clips and scenes
      }
    }, 4000);
    return () => clearInterval(t);
  }, [active, projectId, router]);

  const shown = latestRun(jobs).slice().reverse(); // script first, then scenes in order
  if (!shown.length) return null;
  return (
    <ul className="space-y-2 text-sm">
      {shown.map((j) => (
        <li key={j.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-panel px-3.5 py-2.5">
          <span>
            {j.job_type === "script"
              ? "Writing script and scenes"
              : `Scene ${(j.input?.scene_index ?? 0) + 1}${j.input?.caption ? ` · ${j.input.caption}` : ""}`}
          </span>
          <span className={j.status === "failed" ? "text-danger" : j.status === "succeeded" ? "text-gold" : "text-muted"} title={j.error ?? ""}>
            {(j.status === "running" || j.status === "queued") && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-gold" />}
            {LABEL[j.status] ?? j.status}
          </span>
        </li>
      ))}
    </ul>
  );
}
