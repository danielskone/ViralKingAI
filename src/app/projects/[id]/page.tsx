import { notFound } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Uploader from "@/components/Uploader";
import JobsPanel from "@/components/JobsPanel";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { latestRun } from "@/lib/jobs";
import { isVideo, withUrls } from "@/lib/library";
import { deleteAsset, deleteProject, startGeneration } from "@/app/actions";
import { Arrow, Box, Film, Trash, User } from "@/components/icons";
import DeleteButton from "@/components/DeleteButton";

type ScriptIn = { idea?: string; scene_count?: number; model_shot?: boolean; product_path?: string | null; avatar_path?: string | null; voice?: string | null };

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
  // Everything the page needs, fetched at the same time instead of one after another.
  const [user, { data: project }, { data: assetRows }, { data: jobs }] = await Promise.all([
    getSessionUser(),
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("assets").select("id, kind, storage_path, thumb_path, file_name, mime_type").eq("project_id", id).order("created_at", { ascending: true }),
    supabase.from("generation_jobs").select("id, job_type, status, input, error, created_at, output").eq("project_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (!project || !user) notFound();
  const tall = project.aspect_ratio === "9:16";
  const assets = await withUrls(supabase, assetRows ?? []);
  const clips = await Promise.all(
    assets.filter((a) => a.kind === "generated_clip" || a.kind === "export").reverse().map(async (c) => {
      // A link that saves the file (Safari on iPhone ignores the download attribute on other sites).
      const { data } = await supabase.storage.from("media")
        .createSignedUrl(c.storage_path, 3600, { download: c.file_name || "viralking-video.mp4" });
      return { ...c, saveUrl: data?.signedUrl ?? c.url };
    }),
  );
  const uploads = assets.filter((a) => a.kind !== "generated_clip" && a.kind !== "export");
  // The newest joined video (all scenes back to back) goes on top; the scene clips follow.
  const full = clips.find((c) => c.kind === "export");
  const scenes = clips.filter((c) => c.kind !== "export");
  const ratioClass = tall ? "aspect-[9/16]" : project.aspect_ratio === "1:1" ? "aspect-square" : "aspect-video";

  const run = latestRun(jobs ?? []);
  const busy = run.some((j) => j.status === "queued" || j.status === "running");
  const lastScript = run.find((j) => j.job_type === "script");
  const lastIn = (lastScript?.input ?? {}) as ScriptIn;
  const lastIdea = lastIn.idea ?? project.offer_description ?? "";
  const lastCount = String(lastIn.scene_count ?? 3);
  const lastModelShot = lastIn.model_shot ?? true;
  const lastVoice = lastIn.voice ?? "";
  const script = (lastScript?.status === "succeeded" ? lastScript.output : undefined) as
    | { hook?: string; cta?: string; scenes?: { prompt: string; caption?: string }[] }
    | undefined;
  const picks = await withUrls(
    supabase,
    [
      lastIn.product_path ? { label: "Product", storage_path: lastIn.product_path } : null,
      lastIn.avatar_path ? { label: "Avatar", storage_path: lastIn.avatar_path } : null,
    ].filter(Boolean) as { label: string; storage_path: string }[],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/dashboard" className="text-sm text-muted hover:text-gold">← Create</Link>
            <h1 className="font-display mt-2 text-3xl font-extrabold tracking-tight">{project.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={"rounded-full px-2.5 py-1 font-semibold " + (project.status === "ready" ? "gold-bg text-black" : project.status === "failed" ? "bg-card text-danger" : "bg-card text-foreground")}>
                {project.status}
              </span>
              <span className="rounded-full bg-card px-2.5 py-1 text-muted">{project.aspect_ratio}</span>
              {picks.map((p) => (
                <span key={p.label} className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/5 py-0.5 pl-0.5 pr-2.5 text-gold-light">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.thumb && <img src={p.thumb} alt="" className="h-5 w-5 rounded-full object-cover" />}
                  {p.label === "Product" ? <Box className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}{p.label}
                </span>
              ))}
            </div>
          </div>
          <form action={deleteProject}>
            <input type="hidden" name="id" value={project.id} />
            <button className="btn-ghost text-danger"><Trash className="h-4 w-4" /> Delete</button>
          </form>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* Results */}
          <section className="space-y-4">
            {full && (
              <div className="space-y-3">
                <h2 className="eyebrow">Your full video</h2>
                <div className={"gold-ring overflow-hidden rounded-2xl border border-gold/50 bg-black " + (tall ? "mx-auto max-w-sm" : "")}>
                  {full.url && <video src={full.url} controls playsInline preload="metadata" className={"w-full " + ratioClass + " object-contain"} />}
                  <div className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                    {full.saveUrl && (
                      <a href={full.saveUrl} download className="rounded-full bg-gold px-4 py-2 font-medium text-black hover:opacity-90">Save full video</a>
                    )}
                    <DeleteButton action={deleteAsset} fields={{ id: full.id, project_id: project.id }}
                      label="this video"
                      className="flex items-center gap-1 rounded-full px-3 py-2 text-xs text-muted hover:text-danger" iconClass="h-3.5 w-3.5" text="Delete" />
                  </div>
                </div>
              </div>
            )}
            <h2 className="eyebrow">{full ? "Scenes" : "Your clips"}</h2>
            {scenes.length ? (
              <div className={"grid gap-4 " + (tall ? "grid-cols-2" : "grid-cols-1")}>
                {scenes.map((c) => (
                  <div key={c.id} className="gold-ring overflow-hidden rounded-2xl border border-gold/30 bg-black">
                    {c.url && <video src={c.url} controls playsInline loop preload="metadata" className={"w-full " + ratioClass + " object-contain"} />}
                    <div className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                      {c.saveUrl && (
                        <a href={c.saveUrl} download className="rounded-full bg-gold px-4 py-2 font-medium text-black hover:opacity-90">Save video</a>
                      )}
                      {/* Kept far from Save so a missed tap can't hit it. */}
                      <DeleteButton action={deleteAsset} fields={{ id: c.id, project_id: project.id }}
                        label="this video"
                        className="flex items-center gap-1 rounded-full px-3 py-2 text-xs text-muted hover:text-danger" iconClass="h-3.5 w-3.5" text="Delete" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={"panel flex flex-col items-center justify-center gap-3 text-center text-muted " + (tall ? "aspect-[4/5]" : "aspect-video")}>
                <Film className="h-10 w-10 text-gold" />
                {busy ? "Your AI is filming… this takes about 10–15 minutes." : "No clips yet. Describe your ad and press Generate."}
              </div>
            )}
            <JobsPanel key={lastScript?.id ?? "none"} projectId={project.id} initial={(jobs ?? []).map((j) => ({ ...j, output: undefined }))} />
          </section>

          {/* Generate */}
          <section className="space-y-6">
            <form action={startGeneration} className="gold-ring space-y-3 rounded-2xl border border-gold/30 bg-card p-4">
              <input type="hidden" name="project_id" value={project.id} />
              <p className="eyebrow">Generate {clips.length ? "again" : ""}</p>
              <textarea
                key={lastIdea}
                name="idea"
                defaultValue={lastIdea}
                rows={5}
                maxLength={3000}
                disabled={busy}
                className="w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted/70"
                placeholder="Describe your video, e.g. A confident young man wearing this shirt walks through a snowy downtown street at night, slow cinematic tracking shot."
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <select key={lastCount} name="scene_count" defaultValue={lastCount} className="chip appearance-none pr-3" disabled={busy}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} scene{n > 1 ? "s" : ""}</option>)}
                </select>
                <select key={"v" + lastVoice} name="voice" defaultValue={lastVoice} className="chip appearance-none pr-3" disabled={busy}>
                  <option value="">Silent</option>
                  <option value="af_heart">Woman · warm</option>
                  <option value="af_bella">Woman · bright</option>
                  <option value="am_michael">Man · natural</option>
                  <option value="am_fenrir">Man · deep</option>
                  <option value="bf_emma">Woman · British</option>
                  <option value="bm_george">Man · British</option>
                </select>
                <label className="chip cursor-pointer">
                  <input type="checkbox" name="model_shot" defaultChecked={lastModelShot} disabled={busy} key={String(lastModelShot)} className="accent-[#d4af37]" />
                  On a model
                </label>
                <button className="btn ml-auto" disabled={busy}>
                  {busy ? "Generating…" : <>Generate <Arrow className="h-4 w-4 rotate-90" /></>}
                </button>
              </div>
              {genError && <p className="text-sm text-danger">{genError}</p>}
            </form>

            {script?.scenes?.length ? (
              <div className="panel space-y-3 p-4 text-sm">
                <p className="eyebrow">Script</p>
                {script.hook && <p><span className="text-gold">Hook</span> · {script.hook}</p>}
                <ol className="space-y-2">
                  {script.scenes.map((s, i) => (
                    <li key={i} className="rounded-xl bg-panel p-3">
                      <span className="font-semibold">{i + 1}. {s.caption}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">{s.prompt}</span>
                    </li>
                  ))}
                </ol>
                {script.cta && <p><span className="text-gold">Call to action</span> · {script.cta}</p>}
              </div>
            ) : null}

            <div className="space-y-3">
              <p className="eyebrow">Project media</p>
              <Uploader projectId={project.id} userId={user.id} />
              {uploads.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {uploads.map((a) => (
                    <div key={a.id} className="group relative overflow-hidden rounded-xl border border-border bg-panel">
                      <div className="aspect-square">
                        {a.url && (a.kind === "image" || a.kind === "logo") && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.thumb} alt={a.file_name ?? ""} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        )}
                        {a.url && isVideo(a.kind, a.mime_type) && <video src={a.url} muted preload="metadata" className="h-full w-full object-cover" />}
                        {a.url && a.kind === "audio" && <audio src={a.url} controls className="mt-8 w-full" />}
                      </div>
                      <form action={deleteAsset} className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100">
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="project_id" value={project.id} />
                        <button title="Delete" className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 hover:text-danger"><Trash className="h-3.5 w-3.5" /></button>
                      </form>
                      {a.kind === "logo" && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-gold">Logo</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
