import Link from "next/link";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";
import { createClient } from "@/lib/supabase/server";
import { isVideo, needsThumb, withUrls } from "@/lib/library";
import ThumbBackfill from "@/components/ThumbBackfill";
import { Crown, Film } from "@/components/icons";

const STATUS: Record<string, string> = { draft: "Draft", generating: "Generating", ready: "Ready", failed: "Failed" };

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: library }, { data: projects }, { data: media }] = await Promise.all([
    supabase.from("assets").select("id, kind, storage_path, thumb_path, file_name, mime_type").in("kind", ["product", "avatar"]).order("created_at", { ascending: false }),
    supabase.from("projects").select("id, title, aspect_ratio, status, updated_at").order("updated_at", { ascending: false }).limit(24),
    supabase.from("assets").select("project_id, kind, storage_path, thumb_path, mime_type, created_at").in("kind", ["generated_clip", "image"]).not("project_id", "is", null).order("created_at", { ascending: false }),
  ]);

  const lib = await withUrls(supabase, library ?? []);
  // Cover for each project: newest generated clip, else first photo.
  const covers = new Map<string, { storage_path: string; thumb_path: string | null; kind: string; mime_type: string | null }>();
  for (const m of media ?? []) {
    const cur = covers.get(m.project_id!);
    if (!cur || (cur.kind !== "generated_clip" && m.kind === "generated_clip")) covers.set(m.project_id!, m);
  }
  const coverList = await withUrls(supabase, [...covers.entries()].map(([pid, c]) => ({ ...c, pid })));
  const coverBy = new Map(coverList.map((c) => [c.pid, c]));

  return (
    <AppShell>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(212,175,55,0.18),transparent_70%)]" />
        <section className="relative mx-auto max-w-3xl px-4 pb-10 pt-14 text-center sm:pt-20">
          <div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-3 py-1 text-xs text-gold-light">
            <Crown className="h-4 w-4" /> Your own AI video studio
          </div>
          <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Describe your ad.<br /><span className="gold-text">We make it viral.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            Pick a product and an avatar, describe the scene, and your AI writes the script and films it.
          </p>
          <div className="mt-8 text-left">
            <Composer
              userId={user!.id}
              products={lib.filter((i) => i.kind === "product")}
              avatars={lib.filter((i) => i.kind === "avatar")}
            />
          </div>
        </section>
      </div>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-2xl font-bold">Your projects</h2>
          <Link href="/media?tab=generations" className="text-sm text-muted hover:text-gold">All generations →</Link>
        </div>
        {!projects?.length ? (
          <div className="panel p-10 text-center text-muted">Your ads will appear here. Describe your first one above.</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {projects.map((p) => {
              const c = coverBy.get(p.id);
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="group overflow-hidden rounded-2xl border border-border bg-card transition hover:border-gold/60">
                  <div className="relative aspect-[4/5] bg-panel">
                    {c?.url && isVideo(c.kind, c.mime_type) ? (
                      <video src={c.url} muted loop playsInline autoPlay preload="metadata" className="h-full w-full object-cover" />
                    ) : c?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted"><Film className="h-8 w-8" /></div>
                    )}
                    <span className={"absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur " +
                      (p.status === "ready" ? "gold-bg text-black" : p.status === "failed" ? "bg-black/60 text-danger" : "bg-black/60 text-foreground")}>
                      {p.status === "generating" && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />}
                      {STATUS[p.status] ?? p.status}
                    </span>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-10">
                      <h3 className="truncate font-semibold">{p.title}</h3>
                      <p className="text-xs text-muted">{p.aspect_ratio} · {new Date(p.updated_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
      {lib.some(needsThumb) && <ThumbBackfill userId={user!.id} items={lib.filter(needsThumb).map((i) => ({ id: i.id, url: i.url }))} />}
    </AppShell>
  );
}
