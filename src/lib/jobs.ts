/** Jobs from the most recent Generate click only: its script job plus the scenes it queued. */
export function latestRun<T extends { id: string; job_type: string; input: unknown }>(jobs: T[]): T[] {
  const script = jobs.find((j) => j.job_type === "script"); // jobs are newest first
  if (!script) return jobs;
  return jobs.filter(
    (j) => j.id === script.id || (j.input as { script_job_id?: string } | null)?.script_job_id === script.id,
  );
}
