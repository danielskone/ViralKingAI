import { notFound } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Uploader from "@/components/Uploader";
import { createClient } from "@/lib/supabase/server";
import { deleteAsset, deleteProject } from "@/app/actions";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project || !user) notFound();

  const { data: assets } = await supabase
    .from("assets")
    .select("id, kind, storage_path, file_name, mime_type")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

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

        <section className="rounded-2xl border border-border bg-card p-6 text-sm text-muted">
          AI generation arrives in step 2: your own GPU server will turn these photos and your offer into video scenes.
        </section>
      </main>
    </>
  );
}
