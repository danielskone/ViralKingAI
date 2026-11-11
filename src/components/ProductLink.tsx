"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addProductFromUrl } from "@/app/actions";
import { Link as LinkIcon } from "@/components/icons";

/** Paste a product page link (Shopify, Amazon, Etsy, any store) or a photo link to add a product. */
export default function ProductLink({ onAdded, compact }: { onAdded?: (id: string) => void; compact?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const r = await addProductFromUrl(url);
    setBusy(false);
    if ("error" in r) return setErr(r.error);
    setUrl("");
    onAdded?.(r.id);
    router.refresh();
  }

  return (
    <div className={compact ? "" : "panel p-4"}>
      <div className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-3 pr-1 focus-within:border-gold/60">
        <LinkIcon className="h-4 w-4 shrink-0 text-gold" />
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
          placeholder="Paste a product link…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted/70"
        />
        <button type="button" onClick={go} disabled={busy || !url.trim()}
          className="gold-bg shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40">
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {err ? <p className="mt-2 px-1 text-xs text-danger">{err}</p>
        : <p className="mt-2 px-1 text-xs text-muted">Works with Shopify, Amazon, Etsy and most online stores, or a direct photo link.</p>}
    </div>
  );
}
