import Link from "next/link";
import AppShell from "@/components/AppShell";
import LibraryUpload from "@/components/LibraryUpload";
import { createClient } from "@/lib/supabase/server";
import { isVideo, needsThumb, withUrls } from "@/lib/library";
import ThumbBackfill from "@/components/ThumbBackfill";
import { deleteLibraryItem, toggleLike } from "@/app/actions";
import { Heart, Trash } from "@/components/icons";

const TABS = [
  { id: "uploads", label: "Uploads" },
  { id: "generations", label: "Generations" },
  { id: "liked", label: "Liked" },
  { id: "avatars", label: "Avatars" },
  { id: "products", label: "Products" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const COPY: Record<Tab, { title: string; empty: string; upload?: { kind: "product" | "avatar" | "auto"; label: string } }> = {
  uploads: { title: "Everything you've uploaded", empty: "Upload photos and videos to use in your ads.", upload: { kind: "auto", label: "Upload media" } },
  generations: { title: "Clips your AI has made", empty: "Your generated clips will appear here." },
  liked: { title: "Your favorites", empty: "Tap the heart on any clip or photo to save it here." },
  avatars: { title: "The same person in every ad you make", empty: "Add photos of people (you, a spokesperson, a model) to star in your ads.", upload: { kind: "avatar", label: "New avatar" } },
  products: { title: "Your products, ready for any ad", empty: "Add clean product photos (white background works best).", upload: { kind: "product", label: "Add product" } },
};

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ tab?: string; type?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (TABS.some((t) => t.id === sp.tab) ? sp.tab : "uploads") as Tab;
  const type = sp.type === "images" || sp.type === "videos" ? sp.type : "all";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let q = supabase.from("assets").select("id, kind, storage_path, thumb_path, file_name, mime_type, project_id, liked, created_at").order("created_at", { ascending: false }).limit(200);
  if (tab === "uploads") q = q.in("kind", ["image", "video", "logo", "product", "avatar"]);
  if (tab === "generations") q = q.in("kind", ["generated_clip", "export"]);
  if (tab === "liked") q = q.eq("liked", true);
  if (tab === "avatars") q = q.eq("kind", "avatar");
  if (tab === "products") q = q.eq("kind", "product");
  const { data } = await q;
  let items = await withUrls(supabase, data ?? []);
  if (type === "images") items = items.filter((i) => !isVideo(i.kind, i.mime_type));
  if (type === "videos") items = items.filter((i) => isVideo(i.kind, i.mime_type));
  const missing = items.filter(needsThumb).map((i) => ({ id: i.id, url: i.url }));
  const copy = COPY[tab];
  const portrait = tab === "avatars" || tab === "products";

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap gap-1 rounded-full border border-border bg-panel p-1 sm:w-fit">
          {TABS.map((t) => (
            <Link key={t.id} href={`/media?tab=${t.id}`} className={"tab" + (t.id === tab ? " tab-on" : "")}>{t.label}</Link>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{copy.title}</h1>
          {!portrait && (
            <div className="flex gap-1">
              {(["all", "images", "videos"] as const).map((t) => (
                <Link key={t} href={`/media?tab=${tab}${t === "all" ? "" : `&type=${t}`}`} className={"chip capitalize" + (t === type ? " chip-on" : "")}>{t}</Link>
              ))}
            </div>
          )}
        </div>

        <div className={"mt-6 grid gap-4 " + (portrait ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5")}>
          {copy.upload && <LibraryUpload userId={user!.id} kind={copy.upload.kind} label={copy.upload.label} />}
          {items.map((i, idx) => (
            <div key={i.id} className="group relative overflow-hidden rounded-2xl border border-border bg-card transition hover:border-gold/60">
              <div className="aspect-[4/5] bg-panel">
                {i.url && isVideo(i.kind, i.mime_type) ? (
                  <video src={i.url} controls playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : i.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.thumb} alt={i.file_name ?? ""} loading={idx < 10 ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="absolute right-2 top-2 flex gap-1.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                <form action={toggleLike}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="liked" value={String(i.liked)} />
                  <button title={i.liked ? "Unlike" : "Like"} className={"flex h-8 w-8 items-center justify-center rounded-full bg-black/70 backdrop-blur " + (i.liked ? "text-gold" : "text-foreground hover:text-gold")}>
                    <Heart className="h-4 w-4" filled={i.liked} />
                  </button>
                </form>
                {!i.project_id && (
                  <form action={deleteLibraryItem}>
                    <input type="hidden" name="id" value={i.id} />
                    <button title="Delete" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-foreground backdrop-blur hover:text-danger">
                      <Trash className="h-4 w-4" />
                    </button>
                  </form>
                )}
              </div>
              {i.liked && <Heart className="absolute left-2 top-2 h-4 w-4 text-gold sm:group-hover:opacity-0" filled />}
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="truncate text-muted" title={i.file_name ?? ""}>{(i.file_name ?? "").replace(/\.[a-z0-9]+$/i, "")}</span>
                {i.project_id && <Link href={`/projects/${i.project_id}`} className="shrink-0 text-gold hover:underline">Project</Link>}
              </div>
            </div>
          ))}
        </div>
        {missing.length > 0 && <ThumbBackfill userId={user!.id} items={missing} />}
        {!items.length && <p className="mt-10 text-center text-muted">{copy.empty}</p>}
      </div>
    </AppShell>
  );
}
