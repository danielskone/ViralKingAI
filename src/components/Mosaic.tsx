type Tile = { label: string; g: string; span: number };

// Each tile is a moving "clip" made of layered gradients. Swap any tile for a
// real <video> once we have showcase clips from the generator.
const ROWS: Tile[][] = [
  [
    { label: "Product drop · 9:16", span: 2, g: "radial-gradient(circle at 30% 30%, #ff9a5a 0%, transparent 45%), radial-gradient(circle at 70% 70%, #ff3d6e 0%, transparent 50%), linear-gradient(135deg, #2a0f1f, #120812)" },
    { label: "Street style", span: 2, g: "radial-gradient(circle at 60% 40%, #f5d76e 0%, transparent 40%), linear-gradient(160deg, #3a2f12, #0e0d08)" },
    { label: "Unboxing", span: 5, g: "radial-gradient(circle at 25% 60%, #4ade80 0%, transparent 35%), radial-gradient(circle at 80% 30%, #22d3ee 0%, transparent 40%), linear-gradient(120deg, #06231c, #04121a)" },
    { label: "Night market", span: 5, g: "radial-gradient(circle at 50% 50%, #60a5fa 0%, transparent 35%), radial-gradient(circle at 20% 20%, #a78bfa 0%, transparent 40%), linear-gradient(200deg, #0c1230, #05060f)" },
    { label: "Desert shoot", span: 3, g: "radial-gradient(circle at 40% 70%, #f59e0b 0%, transparent 45%), linear-gradient(180deg, #3b2410, #120a04)" },
    { label: "Glow up", span: 2, g: "radial-gradient(circle at 50% 30%, #f0abfc 0%, transparent 40%), linear-gradient(180deg, #2a0f33, #0a0410)" },
  ],
  [
    { label: "Before / after", span: 5, g: "radial-gradient(circle at 35% 50%, #fb923c 0%, transparent 45%), radial-gradient(circle at 75% 60%, #b45309 0%, transparent 45%), linear-gradient(110deg, #3b1606, #140703)" },
    { label: "Behind the scenes", span: 5, g: "radial-gradient(circle at 50% 40%, #e5e7eb 0%, transparent 30%), linear-gradient(160deg, #262626, #0a0a0a)" },
    { label: "Customer review", span: 3, g: "radial-gradient(circle at 60% 50%, #34d399 0%, transparent 40%), radial-gradient(circle at 30% 30%, #fde68a 0%, transparent 35%), linear-gradient(200deg, #0f2a1d, #06110b)" },
    { label: "Launch day", span: 5, g: "radial-gradient(circle at 70% 30%, #93c5fd 0%, transparent 45%), radial-gradient(circle at 30% 80%, #e0f2fe 0%, transparent 30%), linear-gradient(180deg, #13294b, #070d18)" },
  ],
  [
    { label: "Holiday promo", span: 2, g: "radial-gradient(circle at 50% 40%, #fda4af 0%, transparent 45%), linear-gradient(180deg, #3b0d18, #12050a)" },
    { label: "How it's made", span: 2, g: "radial-gradient(circle at 40% 30%, #fcd34d 0%, transparent 40%), linear-gradient(180deg, #2b2410, #0c0a05)" },
    { label: "Trend remix", span: 3, g: "radial-gradient(circle at 50% 50%, #c4b5fd 0%, transparent 40%), linear-gradient(140deg, #1c1640, #08061a)" },
    { label: "Talking head", span: 3, g: "radial-gradient(circle at 50% 35%, #fbcfe8 0%, transparent 30%), linear-gradient(180deg, #2b1a22, #0b0709)" },
    { label: "Menu reveal", span: 2, g: "radial-gradient(circle at 50% 60%, #fb7185 0%, transparent 40%), radial-gradient(circle at 30% 30%, #fde047 0%, transparent 35%), linear-gradient(180deg, #2a1208, #0c0503)" },
    { label: "Slow motion", span: 5, g: "radial-gradient(circle at 60% 40%, #cbd5e1 0%, transparent 35%), linear-gradient(170deg, #1f2933, #090c10)" },
    { label: "Color pop", span: 3, g: "conic-gradient(from 90deg at 50% 50%, #f472b6, #facc15, #34d399, #60a5fa, #a78bfa, #f472b6)" },
  ],
];

export default function Mosaic() {
  return (
    <div aria-hidden className="flex h-full flex-col gap-3 sm:gap-4">
      {ROWS.map((row, r) => (
        <div key={r} className="flex min-h-0 flex-1 gap-3 sm:gap-4">
          {row.map((t, i) => (
            <div
              key={i}
              className={`tile relative min-w-0 overflow-hidden rounded-xl ${i > 3 ? "hidden md:block" : ""}`}
              style={{ flex: t.span, ["--d" as string]: `-${(r * 7 + i * 3) % 11}s` }}
            >
              <div className="tile-bg absolute inset-[-20%]" style={{ background: t.g }} />
              <div className="absolute inset-0 bg-[radial-gradient(transparent_40%,rgba(0,0,0,0.55))]" />
              {!((r === 0 && i === 3) || (r === 1 && (i === 1 || i === 2))) && (
              <span className="absolute bottom-2 left-2 hidden rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur sm:inline">
                {t.label}
              </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
