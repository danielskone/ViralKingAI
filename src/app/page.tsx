import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Mosaic from "@/components/Mosaic";
import { Wordmark } from "@/components/Header";

const STEPS = [
  { n: "01", t: "Drop in your product", d: "Upload a photo, a clip or just describe your offer. Add your logo once and it's on every video." },
  { n: "02", t: "Your AI writes and shoots", d: "Our own models write a scroll-stopping hook, plan the scenes and animate them into video." },
  { n: "03", t: "Post everywhere", d: "Export crisp 1080p in 9:16, 1:1 or 16:9, ready for TikTok, Reels, Shorts and ads." },
];

const FEATURES = [
  { t: "Photo to video", d: "Bring a still product shot to life with natural camera motion." },
  { t: "Script writer", d: "Hooks, scenes and calls to action tuned for short-form." },
  { t: "Brand kit", d: "Logo, colors and fonts on every video. Coming soon." },
  { t: "Every format", d: "Vertical, square and widescreen from one project." },
  { t: "Private by default", d: "Your media stays in your own secure storage." },
  { t: "Your own AI", d: "Runs on open models we host. No per-seat fees." },
];

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="bg-black">
      <nav className="fixed inset-x-0 top-0 z-30 bg-gradient-to-b from-black/90 to-transparent">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <Wordmark href="/" />
          <div className="hidden items-center gap-8 text-sm text-white/60 md:flex">
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#start" className="hover:text-white">Pricing</a>
          </div>
          <Link href="/login" className="pill-ghost">Sign in</Link>
        </div>
      </nav>

      <header className="relative h-[100svh] min-h-[560px] overflow-hidden px-3 pb-3 pt-16 sm:px-5 sm:pb-5 sm:pt-20">
        <Mosaic />
        <div className="pointer-events-none absolute inset-0 bg-black/20" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_45%_at_center,rgba(0,0,0,0.6),transparent_100%)]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <h1 className="font-display text-[clamp(3.2rem,12vw,10rem)] font-semibold leading-[0.9] tracking-[-0.04em] text-white drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
            Viral<span className="text-accent">King</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/85 sm:text-xl">
            Your AI video studio for scroll-stopping social content, built on your own models.
          </p>
          <Link href="/login" className="pill mt-8">Create with ViralKing</Link>
          <p className="mt-4 text-xs text-white/50">Product photos in. Ready-to-post 1080p videos out.</p>
        </div>
      </header>

      <section id="how" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <p className="eyebrow">How it works</p>
        <h2 className="section-title">From one photo to a feed full of videos.</h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-black p-8">
              <span className="font-display text-sm text-accent">{s.n}</span>
              <h3 className="mt-4 text-xl font-semibold text-white">{s.t}</h3>
              <p className="mt-2 text-white/60">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <p className="eyebrow">Features</p>
        <h2 className="section-title">Everything a creator needs. Nothing you don&apos;t.</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/25">
              <h3 className="font-semibold text-white">{f.t}</h3>
              <p className="mt-2 text-sm text-white/60">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="start" className="relative overflow-hidden border-t border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,61,110,0.25),transparent_60%)]" />
        <div className="relative mx-auto max-w-3xl px-4 py-28 text-center">
          <h2 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-6xl">Start creating today.</h2>
          <p className="mt-4 text-white/60">Free while in early access. Pay only for the video time you use.</p>
          <Link href="/login" className="pill mt-8">Create with ViralKing</Link>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-white/40 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} ViralKing AI</span>
          <span>ViralKingAI.com</span>
        </div>
      </footer>
    </div>
  );
}
