"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveThumb } from "@/lib/thumbs";

/**
 * Catch-up: photos without a small preview (older uploads, products added from a link) get one made
 * in the browser, a few at a time, then the page refreshes so the fast previews show.
 */
export default function ThumbBackfill({ userId, items }: { userId: string; items: { id: string; url?: string }[] }) {
  const router = useRouter();
  const seen = useRef(new Set<string>());
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const queue = items.filter((i) => i.url && !seen.current.has(i.id));
    if (!queue.length) return;
    queue.forEach((i) => seen.current.add(i.id));
    const supabase = createClient();
    setLeft((n) => n + queue.length);
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        try {
          const res = await fetch(it.url!);
          if (res.ok) await saveThumb(supabase, userId, it.id, await res.blob());
        } catch {}
        setLeft((n) => n - 1);
      }
    };
    Promise.all([worker(), worker(), worker()]).then(() => router.refresh());
  }, [items, userId, router]);

  if (!left) return null;
  return (
    <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-gold/30 bg-panel px-4 py-2 text-xs text-muted shadow-2xl">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
      Speeding up {left} photo{left > 1 ? "s" : ""}…
    </div>
  );
}
