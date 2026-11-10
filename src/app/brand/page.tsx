import AppShell from "@/components/AppShell";
import { Brand, Crown } from "@/components/icons";

export default function BrandPage() {
  return (
    <AppShell>
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
        <div className="gold-ring mb-8 flex h-24 w-24 items-center justify-center rounded-3xl border border-gold/30 bg-card">
          <Crown className="h-12 w-12" />
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Your brand in <span className="gold-text">every ad</span></h1>
        <p className="mt-3 text-muted">
          Save your logo, colors, fonts and tone of voice once. ViralKing keeps every video on brand automatically.
        </p>
        <button disabled className="btn mt-8"><Brand className="h-4 w-4" /> Set up brand kit · coming soon</button>
      </div>
    </AppShell>
  );
}
