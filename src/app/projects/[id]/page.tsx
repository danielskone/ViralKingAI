import { notFound } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Uploader from "@/components/Uploader";
import { createClient } from "@/lib/supabase/server";
import JobsPanel from "@/components/JobsPanel";
import { latestRun } from "@/lib/jobs";
import { deleteAsset, deleteProject, startGeneration } from "@/app/actions";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: genError } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project || !user) notFound();

  const { data: assets } = await supabase
    .from("assets")
    .select("id, kind, storage_path, file_name, mime_type")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("id, job_type, status, input, error, created_at, output")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  const run = latestRun(jobs ?? []);
  const busy = run.some((j) => j.status === "queued" || j.status === "running");
  const lastScript = run.find((j) => j.job_type === "script");
  const lastIdea = String((lastScript?.input as { idea?: string } | null)?.idea ?? "");
  const lastCount = String((lastScript?.input as { scene_count?: number } | null)?.scene_count ?? 3);
  const script = (lastScript?.status === "succeeded" ? lastScript.output : undefined) as
    | { hook?: string; cta?: string; scenes?: { prompt: string; caption?: string }[] }
    | undefined;

  const urls = new Map<string, string>();
  if (assets?.length) {
    const { data: signed } = await supabase.storage
      .from("media")
      .createSignedUrls(assets.map((a) => a.storage_path), 60 * 60);
    signed?.forEach((s) => s.path && s.signedUrl && urls.set(s.path, s.signedUrl));
  }

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">← All projects</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{project.title}</h1>
            {project.offer_description && <p className="mt-1 text-muted">{project.offer_description}</p>}
            <p className="mt-1 text-xs text-muted">{project.aspect_ratio} · {project.status}</p>
          </div>
          <form action={deleteProject}>
            <input type="hidden" name="id" value={project.id} />
            <button className="btn-ghost text-accent">Delete project</button>
          </form>
        </div>

        <Uploader projectId={project.id} userId={user.id} />

        <section>
          <h2 className="mb-3 text-lg font-semibold">Media</h2>
          {!assets?.length ? (
            <p className="text-sm text-muted">Nothing uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {assets.map((a) => {
                const url = urls.get(a.storage_path);
                return (
                  <div key={a.id} className="overflow-hidden rounded-xl border border-border bg-card">
                    <div className="flex aspect-square items-center justify-center bg-background">
                      {url && (a.kind === "image" || a.kind === "logo") && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={a.file_name ?? ""} className="h-full w-full object-contain" />
                      )}
                      {url && (a.kind === "video" || a.kind === "generated_clip" || a.kind === "export") && (
                        <video src={url} controls className="h-full w-full object-contain" />
                      )}
                      {url && a.kind === "audio" && <audio src={url} controls className="w-11/12" />}
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2 text-xs">
                      <span className="truncate text-muted" title={a.file_name ?? ""}>
                        {a.kind === "logo" ? "Logo · " : ""}{a.file_name}
                      </span>
                      <form action={deleteAsset}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="project_id" value={project.id} />
                        <button className="text-muted hover:text-accent">Delete</button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
          <form action={startGeneration} className="space-y-3">
            <input type="hidden" name="project_id" value={project.id} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Generate with AI</h2>
                <p className="text-sm text-muted">
                  Describe the video you want. Your own AI turns it into detailed scenes and animates your first photo.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select key={lastCount} name="scene_count" defaultValue={lastCount} className="input w-auto" disabled={busy}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} scene{n > 1 ? "s" : ""}</option>
                  ))}
                </select>
                <button className="btn" disabled={busy}>{busy ? "Generating…" : "Generate scenes"}</button>
              </div>
            </div>
            <textarea
              key={lastIdea}
              name="idea"
              defaultValue={lastIdea}
              rows={3}
              maxLength={600}
              disabled={busy}
              className="input w-full resize-y"
              placeholder="Describe your video (optional). Example: A confident young man wearing this shirt walks through a snowy downtown street at night, Christmas lights glowing, slow cinematic tracking shot."
            />
          </form>
          {genError && <p className="text-sm text-accent">{genError}</p>}
          {script?.scenes?.length ? (
            <div className="space-y-2 text-sm">
              {script.hook && <p><span className="text-muted">Hook:</span> {script.hook}</p>}
              <ol className="list-decimal space-y-1 pl-5">
                {script.scenes.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.caption}</span>
                    <span className="block text-muted">{s.prompt}</span>
                  </li>
                ))}
              </ol>
              {script.cta && <p><span className="text-muted">Call to action:</span> {script.cta}</p>}
            </div>
          ) : null}
          <JobsPanel key={lastScript?.id ?? "none"} projectId={project.id} initial={(jobs ?? []).map(({ output: _o, ...j }) => j)} />
        </section>
      </main>
    </>
  );
}
