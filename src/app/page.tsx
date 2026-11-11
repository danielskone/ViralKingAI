import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import Mosaic from "@/components/Mosaic";
import { Wordmark } from "@/components/AppShell";
import { Box, Brand, Film, Sparkle, User } from "@/components/icons";

const STEPS = [
  { n: "01", t: "Add your product", d: "Upload a clean product photo, or pick one from your library." },
  { n: "02", t: "Describe the ad", d: "Type the scene you imagine. Your AI writes a cinematic script for it." },
  { n: "03", t: "Get your video", d: "Your own AI puts the product on a model and films every scene." },
];
const FEATURES = [
  { i: <Sparkle />, t: "Your own AI", d: "Open models running on your GPUs. No per-video fees to anyone else." },
  { i: <User />, t: "Avatars", d: "Keep the same face in every ad: you, a spokesperson or a model." },
  { i: <Box />, t: "Products", d: "Save products once and drop them into any ad in one click." },
  { i: <Film />, t: "Every format", d: "Vertical for Reels and TikTok, wide for YouTube, square for feeds." },
  { i: <Brand />, t: "Brand kit", d: "Logo, colors and tone of voice on every video. Coming soon." },
];

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <main>
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/5 bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Wordmark href="/" />
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost hidden sm:inline-flex">Sign in</Link>
            <Link href="/login" className="btn">Start creating</Link>
          </div>
        </div>
      </header>

      <section className="relative h-[100svh] min-h-[620px] overflow-hidden px-3 pb-3 pt-16">
        <Mosaic />
        <div className="absolute inset-0 bg-[radial-gradient(55%_50%_at_50%_55%,rgba(0,0,0,0.92),rgba(0,0,0,0.55)_60%,transparent)]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <p className="eyebrow mb-5 text-gold-light">AI video ads, made by your own AI</p>
          <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl">
            Viral<span className="gold-text">King</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/80">Describe your ad. We write it, cast it and film it. Ready to post in minutes.</p>
          <Link href="/login" className="btn mt-8 px-7 py-3 text-base">Create with ViralKing</Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-24">
        <p className="eyebrow text-center">How it works</p>
        <h2 className="font-display mt-3 text-center text-3xl font-bold sm:text-5xl">From idea to ad in <span className="gold-text">three steps</span></h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="panel p-6 transition hover:border-gold/50">
              <span className="font-display gold-text text-4xl font-extrabold">{s.n}</span>
              <h3 className="mt-4 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24">
        <h2 className="font-display text-3xl font-bold sm:text-4xl">Everything you need to <span className="gold-text">go viral</span></h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map((f) => (
            <div key={f.t} className="panel p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold">{f.i}</span>
              <h3 className="mt-4 font-semibold">{f.t}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pb-24">
        <div className="gold-ring mx-auto max-w-4xl rounded-3xl border border-gold/30 bg-[radial-gradient(80%_120%_at_50%_0%,rgba(212,175,55,0.18),transparent_60%)] px-6 py-16 text-center">
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl">Your next ad is one sentence away</h2>
          <Link href="/login" className="btn mt-8 px-7 py-3 text-base">Start creating</Link>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between text-sm text-muted">
          <Wordmark href="/" />
          <span>© {new Date().getFullYear()} ViralKing AI</span>
        </div>
      </footer>
    </main>
  );
}
