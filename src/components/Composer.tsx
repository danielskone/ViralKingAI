"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAndGenerate } from "@/app/actions";
import { uploadToLibrary } from "@/components/LibraryUpload";
import { Arrow, Box, Check, ChevronDown, Layers, Plus, Ratio, Sparkle, User } from "@/components/icons";

type Item = { id: string; url?: string; thumb?: string; file_name: string | null };

const STARTERS = [
  { label: "Product hero", text: "Slow cinematic push-in on the product on a dark marble pedestal, soft golden rim light, floating dust particles, luxury commercial look." },
  { label: "UGC review", text: "A friendly creator holds the product up to the camera in a bright, cozy apartment, smiles and nods, handheld phone-style shot, natural window light." },
  { label: "Lifestyle", text: "A confident person wearing the product walks down a busy downtown street at golden hour, slow tracking shot, shallow depth of field, warm film look." },
  { label: "Holiday promo", text: "The product in a festive living room with a glowing Christmas tree, gentle snowfall outside the window, slow orbit shot, warm cozy lighting." },
];

function Picker({
  icon, label, items, value, onChange, kind, userId,
}: {
  icon: React.ReactNode; label: string; items: Item[]; value: string | null;
  onChange: (id: string | null) => void; kind: "product" | "avatar"; userId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chosen = items.find((i) => i.id === value);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className={"chip" + (chosen ? " chip-on" : "")}>
        {chosen?.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={chosen.thumb} alt="" className="h-4 w-4 rounded-full object-cover" />
        ) : icon}
        {chosen ? (chosen.file_name ?? label).replace(/\.[a-z0-9]+$/i, "").slice(0, 18) : label}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(22rem,80vw)] rounded-2xl border border-border bg-panel p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Choose {label.toLowerCase()}</p>
            {value && <button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => { onChange(null); setOpen(false); }}>Clear</button>}
          </div>
          <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted hover:border-gold/60 hover:text-foreground">
              <Plus className="h-4 w-4" />{busy ? "Uploading…" : "Upload"}
              <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setBusy(true);
                try {
                  const id = await uploadToLibrary(f, userId, kind);
                  onChange(id);
                  router.refresh();
                } catch (x) { alert((x as Error).message); }
                setBusy(false);
              }} />
            </label>
            {items.map((i) => (
              <button type="button" key={i.id} onClick={() => { onChange(i.id); setOpen(false); }}
                className={"relative aspect-square overflow-hidden rounded-xl border " + (i.id === value ? "border-gold" : "border-border hover:border-gold/60")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.thumb && <img src={i.thumb} alt={i.file_name ?? ""} loading="lazy" decoding="async" className="h-full w-full object-cover" />}
                {i.id === value && <span className="gold-bg absolute right-1 top-1 rounded-full p-0.5 text-black"><Check className="h-3 w-3" /></span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A chip that opens a small menu of choices (used for Format and Scenes). */
function Dropdown<T extends string | number>({ icon, label, options, value, onChange }: {
  icon: React.ReactNode; label: string; options: { value: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className={"chip" + (open ? " chip-on" : "")}>
        {icon}{current?.label}
        <ChevronDown className={"h-3.5 w-3.5 opacity-70 transition " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-20 mt-2 min-w-[12rem] rounded-2xl border border-border bg-panel p-1.5 shadow-2xl">
          <p className="eyebrow px-3 pb-1 pt-2">{label}</p>
          {options.map((o) => (
            <button type="button" role="option" aria-selected={o.value === value} key={String(o.value)}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={"flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-card " + (o.value === value ? "text-gold" : "text-foreground")}>
              <span className="flex-1">
                {o.label}
                {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
              </span>
              {o.value === value && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FORMATS: { value: "9:16" | "16:9" | "1:1"; label: string; hint: string }[] = [
  { value: "9:16", label: "Vertical 9:16", hint: "TikTok, Reels, Shorts" },
  { value: "16:9", label: "Wide 16:9", hint: "YouTube, website" },
  { value: "1:1", label: "Square 1:1", hint: "Instagram & Facebook feed" },
];
const SCENES = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} scene${n > 1 ? "s" : ""}`, hint: `About ${n * 5} seconds` }));

export default function Composer({ products, avatars, userId }: { products: Item[]; avatars: Item[]; userId: string }) {
  const [idea, setIdea] = useState("");
  const [product, setProduct] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [scenes, setScenes] = useState(1);
  const [modelShot, setModelShot] = useState(true);
  const [pending, setPending] = useState(false);

  return (
    <form action={createAndGenerate} onSubmit={() => setPending(true)} className="gold-ring rounded-3xl border border-gold/30 bg-card p-4 sm:p-5">
      <input type="hidden" name="product_id" value={product ?? ""} />
      <input type="hidden" name="avatar_id" value={avatar ?? ""} />
      <input type="hidden" name="aspect_ratio" value={aspect} />
      <input type="hidden" name="scene_count" value={scenes} />
      <input type="hidden" name="model_shot" value={product && modelShot ? "on" : ""} />
      <textarea
        name="idea"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        required
        rows={3}
        maxLength={600}
        placeholder={'Describe your ad, e.g. "A confident young man wearing my shirt walks through a snowy downtown street at night, Christmas lights glowing…"'}
        className="w-full resize-none bg-transparent text-base leading-relaxed text-foreground outline-none placeholder:text-muted/70"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Picker icon={<Box className="h-4 w-4" />} label="Product" items={products} value={product} onChange={setProduct} kind="product" userId={userId} />
        <Picker icon={<User className="h-4 w-4" />} label="Avatar" items={avatars} value={avatar} onChange={setAvatar} kind="avatar" userId={userId} />
        <Dropdown icon={<Ratio className="h-4 w-4" />} label="Format" options={FORMATS} value={aspect} onChange={setAspect} />
        <Dropdown icon={<Layers className="h-4 w-4" />} label="Scenes" options={SCENES} value={scenes} onChange={setScenes} />
        {product && !avatar && (
          <button type="button" onClick={() => setModelShot(!modelShot)} className={"chip" + (modelShot ? " chip-on" : "")}>
            <Sparkle className="h-4 w-4" /> On a model
          </button>
        )}
        <button disabled={pending || !idea.trim()} title="Generate (Ctrl+Enter)"
          className="gold-bg ml-auto flex h-11 w-11 items-center justify-center rounded-full text-black transition hover:brightness-110 disabled:opacity-40">
          {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" /> : <Arrow />}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <span className="eyebrow mr-1 self-center">Try</span>
        {STARTERS.map((s) => (
          <button type="button" key={s.label} className="chip" onClick={() => setIdea(s.text)}>{s.label}</button>
        ))}
      </div>
    </form>
  );
}
