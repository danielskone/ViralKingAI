import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Box, Check, Crown, Film, Layers, Mic, Ratio, Sparkle, User } from "@/components/icons";

export const metadata = { title: "Tutorial · ViralKing AI" };

type Step = { icon: React.ReactNode; title: string; body: React.ReactNode; tip?: string; cta?: { href: string; label: string } };

const STEPS: Step[] = [
  {
    icon: <Box className="h-5 w-5" />,
    title: "Add your product",
    body: <>Go to <b>Products</b> and tap <b>Add product</b>. Upload a clean photo of what you sell, or paste a product link (Amazon, TikTok Shop, Shopify) and the app grabs the photo for you.</>,
    tip: "A plain white or simple background works best.",
    cta: { href: "/media?tab=products", label: "Open Products" },
  },
  {
    icon: <User className="h-5 w-5" />,
    title: "Add an avatar",
    body: <>Go to <b>Avatars</b> and tap <b>New avatar</b>. This is the person who stars in your ad: you, a spokesperson or a model. The same face is used in every scene.</>,
    tip: "Use a chest-up photo where the face is big and clear. Full-body photos make lip sync fail.",
    cta: { href: "/media?tab=avatars", label: "Open Avatars" },
  },
  {
    icon: <Sparkle className="h-5 w-5" />,
    title: "Describe your ad",
    body: <>On <b>Create</b>, type what should happen in the box, or tap <b>Write it for me</b>. Tap the small arrow next to it to see every ready-made idea.</>,
    tip: "Want exact words? Put them in quote marks, like: She says: \"I love these! Tap the link below and grab yours!\" Each sentence becomes one scene.",
  },
  {
    icon: <Ratio className="h-5 w-5" />,
    title: "Pick your settings",
    body: (
      <ul className="mt-1 space-y-1.5">
        <li className="flex gap-2"><Box className="mt-0.5 h-4 w-4 shrink-0 text-gold" /><span><b>Product</b> and <b>Avatar</b>: tap each and choose one.</span></li>
        <li className="flex gap-2"><Ratio className="mt-0.5 h-4 w-4 shrink-0 text-gold" /><span><b>Format</b>: Vertical 9:16 for TikTok, Reels and Shorts.</span></li>
        <li className="flex gap-2"><Layers className="mt-0.5 h-4 w-4 shrink-0 text-gold" /><span><b>Scenes</b>: each is about 5 seconds. 3 scenes is about 15 seconds.</span></li>
        <li className="flex gap-2"><Mic className="mt-0.5 h-4 w-4 shrink-0 text-gold" /><span><b>Voice</b>: tap the play button to hear each one. Pick Silent for no talking.</span></li>
      </ul>
    ),
  },
  {
    icon: <Crown className="h-5 w-5" />,
    title: "Tap the gold arrow to generate",
    body: <>Your AI writes the script, puts the product in the avatar&apos;s hands, films each scene and adds the voice with moving lips. You can close the app while it works.</>,
    tip: "It takes about 15 to 30 minutes. Fewer scenes is faster and cheaper.",
  },
  {
    icon: <Film className="h-5 w-5" />,
    title: "Save and post",
    body: <>Open your project. When all scenes are done, they are joined into one video at the top. Tap <b>Save full video</b>, then post it to TikTok, Instagram or YouTube.</>,
    tip: "The last scene ends with your real product photo and the call to action.",
  },
];

const PROMPT = `UGC TikTok Shop style. She holds the product in a cozy living room, smiles at the camera, warm lighting, slow handheld push-in. She says: "Okay, I found the cutest gift of the year. Everyone I gave this to loved it. Tap the link below and grab yours!"`;

export default function TutorialPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <p className="eyebrow">Tutorial</p>
        <h1 className="font-display mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">
          Your first ad in <span className="gold-text">6 steps</span>
        </h1>
        <p className="mt-3 max-w-xl text-muted">Everything you need to go from a product photo to a finished video you can post.</p>

        <ol className="mt-10 space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel flex gap-4 p-5">
              <div className="flex flex-col items-center gap-2">
                <span className="gold-bg flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-black">{i + 1}</span>
                {i < STEPS.length - 1 && <span className="w-px flex-1 bg-gold/20" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold"><span className="text-gold">{s.icon}</span>{s.title}</h2>
                <div className="mt-1.5 text-sm leading-relaxed text-foreground/85">{s.body}</div>
                {s.tip && (
                  <p className="mt-3 flex gap-2 rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-gold-light">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />{s.tip}
                  </p>
                )}
                {s.cta && <Link href={s.cta.href} className="chip mt-3 inline-flex">{s.cta.label} →</Link>}
              </div>
            </li>
          ))}
        </ol>

        <section className="panel mt-8 p-5">
          <h2 className="font-display text-lg font-bold">A prompt that works</h2>
          <p className="mt-1 text-sm text-muted">Copy this into the box on Create to try it. Swap the words in quotes for your own.</p>
          <p className="mt-3 rounded-xl bg-panel p-3 text-sm leading-relaxed">{PROMPT}</p>
        </section>

        <section className="panel mt-4 p-5">
          <h2 className="font-display text-lg font-bold">Good to know</h2>
          <ul className="mt-2 space-y-2 text-sm text-foreground/85">
            <li>• Each scene is a 5-second clip. More scenes means a longer video, more time and more cost.</li>
            <li>• Lines over about 14 words per scene get cut, so keep each sentence short.</li>
            <li>• If her lips don&apos;t move in a scene, the face was too small in that shot. A closer avatar photo fixes it.</li>
            <li>• Videos are 720p. Every finished video is saved in <Link href="/media?tab=generations" className="text-gold hover:underline">All media</Link>.</li>
          </ul>
        </section>

        <div className="mt-10 text-center">
          <Link href="/dashboard" className="btn">Make my first ad</Link>
        </div>
      </div>
    </AppShell>
  );
}
