"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAndGenerate } from "@/app/actions";
import { uploadToLibrary } from "@/components/LibraryUpload";
import ProductLink from "@/components/ProductLink";
import { Arrow, Box, Check, ChevronDown, Layers, Mic, Play, Plus, Ratio, Sparkle, User } from "@/components/icons";

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
        <div className="absolute left-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-gold/30 bg-panel p-3 shadow-2xl shadow-black/60">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Choose {label.toLowerCase()}</p>
            {value && <button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => { onChange(null); setOpen(false); }}>Clear</button>}
          </div>
          {kind === "product" && (
            <div className="mb-3">
              <ProductLink compact onAdded={(id) => { onChange(id); setOpen(false); }} />
            </div>
          )}
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
  icon: React.ReactNode; label: string; options: { value: T; label: string; hint?: string; shape?: React.ReactNode; preview?: string }[]; value: T; onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = () => { audio.current?.pause(); setPlaying(null); };
  const listen = (src: string) => {
    if (playing === src) return stop();
    audio.current?.pause();
    const a = new Audio(src);
    audio.current = a;
    a.onended = a.onerror = () => setPlaying((p) => (p === src ? null : p));
    setPlaying(src);
    a.play().catch(() => setPlaying(null));
  };
  useEffect(() => { if (!open) stop(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
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
        <div role="listbox" className="absolute left-0 top-full z-40 mt-2 max-h-[60vh] w-60 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-gold/30 bg-panel p-1.5 shadow-2xl shadow-black/60">
          <p className="eyebrow px-3 pb-1 pt-1.5">{label}</p>
          {options.map((o) => (
            <div key={String(o.value)} className={"flex items-center rounded-xl transition hover:bg-card " + (o.value === value ? "bg-gold/10 text-gold" : "text-foreground")}>
              {o.preview && (
                <button type="button" onClick={() => listen(o.preview!)} aria-label={(playing === o.preview ? "Stop " : "Hear ") + o.label}
                  title={playing === o.preview ? "Stop" : "Hear this voice"}
                  className={"ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition " + (playing === o.preview ? "gold-bg border-transparent text-black" : "border-gold/40 text-gold hover:bg-gold/10")}>
                  {playing === o.preview ? <span className="h-2.5 w-2.5 rounded-[2px] bg-black" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
                </button>
              )}
              <button type="button" role="option" aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm">
                {o.shape && <span className="flex h-7 w-7 shrink-0 items-center justify-center">{o.shape}</span>}
                <span className="min-w-0 flex-1 leading-tight">
                  {o.label}
                  {o.hint && <span className="mt-0.5 block truncate text-xs text-muted">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Shape = ({ w, h }: { w: number; h: number }) => <span className="block rounded-[3px] border-[1.5px] border-current" style={{ width: w, height: h }} />;
const FORMATS: { value: "9:16" | "16:9" | "1:1"; label: string; hint: string; shape: React.ReactNode }[] = [
  { value: "9:16", label: "Vertical 9:16", hint: "TikTok, Reels, Shorts", shape: <Shape w={13} h={22} /> },
  { value: "16:9", label: "Wide 16:9", hint: "YouTube, website", shape: <Shape w={24} h={14} /> },
  { value: "1:1", label: "Square 1:1", hint: "Instagram & Facebook feed", shape: <Shape w={18} h={18} /> },
];
const SAMPLES = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/voice-samples`;
const VOICE_OPTS: { value: string; label: string; hint: string; preview?: string }[] = [
  { value: "", label: "Silent", hint: "No voice, just video" },
  { value: "af_heart", label: "Woman · warm", hint: "American, friendly", preview: `${SAMPLES}/af_heart.mp3` },
  { value: "af_bella", label: "Woman · bright", hint: "American, upbeat", preview: `${SAMPLES}/af_bella.mp3` },
  { value: "am_michael", label: "Man · natural", hint: "American, relaxed", preview: `${SAMPLES}/am_michael.mp3` },
  { value: "am_fenrir", label: "Man · deep", hint: "American, bold", preview: `${SAMPLES}/am_fenrir.mp3` },
  { value: "bf_emma", label: "Woman · British", hint: "British, polished", preview: `${SAMPLES}/bf_emma.mp3` },
  { value: "bm_george", label: "Man · British", hint: "British, classic", preview: `${SAMPLES}/bm_george.mp3` },
];
const SCENES = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} scene${n > 1 ? "s" : ""}`, hint: `About ${n * 5} seconds` }));

/** Ready-made ad ideas, matched to what's picked (avatar + product, product only, avatar only, nothing). */
const AUTO: Record<"both" | "product" | "avatar" | "none", string[]> = {
  both: [
    "The person holds the product up to the camera with a big genuine smile, then shows it off and turns slowly so we see every detail. Bright cozy home, soft window light, handheld phone-style UGC shot, warm and friendly.",
    "The person is wearing the product and walks toward the camera with confidence, then stops, smiles and points to it. Golden-hour city street, shallow depth of field, slow tracking shot, warm cinematic film look.",
    "Close-up unboxing moment: the person lifts the product out, reacts with excitement, then holds it next to their face and nods at the camera. Clean bright room, natural light, handheld vertical selfie-style shot.",
    "The person shows the product in a festive living room with a glowing Christmas tree and twinkling lights, smiles and gestures toward it like a gift. Slow gentle push-in, warm cozy holiday lighting.",
    "The person stands in a bright modern kitchen, picks up the product, looks impressed and gives a thumbs up to the camera. Steady medium shot slowly pushing in, soft morning light, clean commercial look.",
  ],
  product: [
    "Slow cinematic push-in on the product on a dark marble pedestal, soft golden rim light, floating dust particles in the air, luxury commercial look, rich deep shadows.",
    "The product slowly rotates on a clean white surface while soft light sweeps across it, highlighting textures and details, minimal premium studio commercial style.",
    "The product sits in a festive scene with a glowing Christmas tree, gift boxes and gentle snowfall outside the window, slow orbit shot, warm cozy holiday lighting.",
    "Dynamic product reveal: the camera glides past soft-focus foreground objects to reveal the product in sharp focus, warm sunset light streaming through a window, cinematic commercial look.",
  ],
  avatar: [
    "The person looks into the camera with a warm confident smile, nods and starts talking enthusiastically like they're sharing a favorite find. Bright home, soft window light, handheld UGC phone shot.",
    "The person walks through a bright sunny room toward the camera, waves hello and smiles, natural friendly energy, slow tracking shot, warm natural light.",
    "The person laughs, turns to the camera and gestures excitedly as if revealing big news, cozy living room, warm lighting, handheld vertical selfie-style shot.",
  ],
  none: [
    "A confident young creator in a bright apartment smiles at the camera and holds up a sleek new product, handheld phone-style UGC shot, soft natural window light.",
    "Slow cinematic push-in on a luxury product on a dark marble pedestal, golden rim light, floating dust particles, premium commercial look.",
  ],
};

export default function Composer({ products, avatars, userId }: { products: Item[]; avatars: Item[]; userId: string }) {
  const [idea, setIdea] = useState("");
  const [product, setProduct] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [scenes, setScenes] = useState(1);
  const [modelShot, setModelShot] = useState(true);
  const [voice, setVoice] = useState("af_heart");
  const [pending, setPending] = useState(false);
  const [autoN, setAutoN] = useState(0);
  const writeForMe = () => {
    const list = AUTO[product && avatar ? "both" : product ? "product" : avatar ? "avatar" : "none"];
    setIdea(list[autoN % list.length]);
    setAutoN(autoN + 1);
  };

  return (
    <form action={createAndGenerate} onSubmit={() => setPending(true)} className="gold-ring rounded-3xl border border-gold/30 bg-card p-4 sm:p-5">
      <input type="hidden" name="product_id" value={product ?? ""} />
      <input type="hidden" name="avatar_id" value={avatar ?? ""} />
      <input type="hidden" name="aspect_ratio" value={aspect} />
      <input type="hidden" name="scene_count" value={scenes} />
      <input type="hidden" name="model_shot" value={product && modelShot ? "on" : ""} />
      <input type="hidden" name="voice" value={voice} />
      <textarea
        name="idea"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        rows={3}
        maxLength={600}
        placeholder={'Describe your ad, press "Write it for me", or leave it empty and the AI picks the idea.'}
        className="w-full resize-none bg-transparent text-base leading-relaxed text-foreground outline-none placeholder:text-muted/70"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Picker icon={<Box className="h-4 w-4" />} label="Product" items={products} value={product} onChange={setProduct} kind="product" userId={userId} />
        <Picker icon={<User className="h-4 w-4" />} label="Avatar" items={avatars} value={avatar} onChange={setAvatar} kind="avatar" userId={userId} />
        <Dropdown icon={<Ratio className="h-4 w-4" />} label="Format" options={FORMATS} value={aspect} onChange={setAspect} />
        <Dropdown icon={<Layers className="h-4 w-4" />} label="Scenes" options={SCENES} value={scenes} onChange={setScenes} />
        <Dropdown icon={<Mic className="h-4 w-4" />} label="Voice" options={VOICE_OPTS} value={voice} onChange={setVoice} />
        {product && !avatar && (
          <button type="button" onClick={() => setModelShot(!modelShot)} className={"chip" + (modelShot ? " chip-on" : "")}>
            <Sparkle className="h-4 w-4" /> On a model
          </button>
        )}
        <button disabled={pending} title="Generate (Ctrl+Enter)"
          className="gold-bg ml-auto flex h-11 w-11 items-center justify-center rounded-full text-black transition hover:brightness-110 disabled:opacity-40">
          {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" /> : <Arrow />}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <button type="button" onClick={writeForMe} className="chip chip-on">
          <Sparkle className="h-4 w-4" /> {idea && autoN ? "Another idea" : "Write it for me"}
        </button>
        <span className="eyebrow mx-1 self-center">or try</span>
        {STARTERS.map((s) => (
          <button type="button" key={s.label} className="chip" onClick={() => setIdea(s.text)}>{s.label}</button>
        ))}
      </div>
    </form>
  );
}
