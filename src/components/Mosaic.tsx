// Decorative "clip wall" in gold, black and white. Swap tiles for real clips later.
const G = {
  gold: "radial-gradient(circle at 35% 35%, #f3d77b 0%, transparent 42%), radial-gradient(circle at 75% 70%, #a67c1a 0%, transparent 45%), linear-gradient(140deg, #2a2108, #0a0904)",
  ivory: "radial-gradient(circle at 55% 35%, #fafafa 0%, transparent 32%), linear-gradient(170deg, #2a2a2a, #0b0b0b)",
  ember: "radial-gradient(circle at 40% 65%, #d4af37 0%, transparent 38%), radial-gradient(circle at 80% 20%, #fff3c4 0%, transparent 25%), linear-gradient(200deg, #1d1606, #070604)",
  night: "radial-gradient(circle at 60% 40%, #d4af37 0%, transparent 22%), radial-gradient(circle at 20% 80%, #f5f5f5 0%, transparent 18%), linear-gradient(180deg, #121212, #040404)",
  silk: "conic-gradient(from 120deg at 50% 50%, #0a0a0a, #a67c1a, #f3d77b, #0a0a0a 70%)",
  smoke: "radial-gradient(circle at 50% 50%, #e5e5e5 0%, transparent 30%), radial-gradient(circle at 20% 20%, #d4af37 0%, transparent 30%), linear-gradient(120deg, #1a1a1a, #050505)",
};
const ROWS: { label: string; g: string; span: number }[][] = [
  [
    { label: "Product drop", span: 2, g: G.gold }, { label: "Street style", span: 3, g: G.ivory },
    { label: "Unboxing", span: 4, g: G.ember }, { label: "Night launch", span: 3, g: G.night }, { label: "Luxury reveal", span: 2, g: G.silk },
  ],
  [
    { label: "Customer review", span: 4, g: G.smoke }, { label: "Behind the scenes", span: 3, g: G.gold },
    { label: "Holiday promo", span: 2, g: G.ember }, { label: "Talking head", span: 4, g: G.ivory },
  ],
  [
    { label: "Slow motion", span: 3, g: G.night }, { label: "Before / after", span: 2, g: G.silk },
    { label: "Menu reveal", span: 4, g: G.gold }, { label: "Glow up", span: 2, g: G.smoke }, { label: "Lifestyle", span: 3, g: G.ember },
  ],
];

export default function Mosaic() {
  return (
    <div aria-hidden className="flex h-full flex-col gap-3">
      {ROWS.map((row, r) => (
        <div key={r} className="flex min-h-0 flex-1 gap-3">
          {row.map((t, i) => (
            <div key={i} className={`relative min-w-0 overflow-hidden rounded-xl ${i > 2 ? "hidden md:block" : ""}`}
              style={{ flex: t.span, ["--d" as string]: `-${(r * 5 + i * 3) % 11}s` }}>
              <div className="tile-bg absolute inset-[-20%]" style={{ background: t.g }} />
              <div className="absolute inset-0 bg-[radial-gradient(transparent_40%,rgba(0,0,0,0.6))]" />
              <span className="absolute bottom-2 left-2 hidden rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur sm:inline">{t.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
