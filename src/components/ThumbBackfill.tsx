"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveThumb } from "@/lib/thumbs";

/**
 * One-time catch-up: photos uploaded before previews existed get a small preview made in the browser.
 * Runs quietly in the background, a few at a time, then refreshes the page so the fast previews show.
 */
export default function ThumbBackfill({ userId, items }: { userId: string; items: { id: string; url?: string }[] }) {
  const router = useRouter();
  const started = useRef(false);
  const [left, setLeft] = useState(items.length);

  useEffect(() => {
    if (started.current || !items.length) return;
    started.current = true;
    const supabase = createClient();
    const queue = items.filter((i) => i.url);
    let done = 0;
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        try {
          const res = await fetch(it.url!);
          if (res.ok) await saveThumb(supabase, userId, it.id, await res.blob());
        } catch {}
        done++;
        setLeft(items.length - done);
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
