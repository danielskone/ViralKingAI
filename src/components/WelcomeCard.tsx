"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crown } from "@/components/icons";

const KEY = "vk-welcome-dismissed";

/** A one-time "new here?" card on Create that points to the tutorial. Hidden once closed. */
export default function WelcomeCard() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem(KEY) !== "1"); } catch { setShow(true); }
  }, []);
  if (!show) return null;
  const close = () => {
    setShow(false);
    try { localStorage.setItem(KEY, "1"); } catch { /* private mode: card just comes back next time */ }
  };
  return (
    <div className="mx-auto mb-6 flex max-w-3xl items-center gap-3 rounded-2xl border border-gold/40 bg-gold/10 p-3 text-left text-sm sm:p-4">
      <Crown className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">New here? Make your first ad in 6 easy steps.</p>
        <p className="text-xs text-muted">Takes 2 minutes to read.</p>
      </div>
      <Link href="/tutorial" onClick={close} className="gold-bg shrink-0 rounded-full px-4 py-2 text-xs font-semibold text-black">Start tutorial</Link>
      <button type="button" onClick={close} aria-label="Close" className="shrink-0 px-1 text-lg leading-none text-muted hover:text-foreground">×</button>
    </div>
  );
}
