"use client";

import { useEffect } from "react";

/** Registers the small offline helper (public/sw.js) so the app opens fast on a weak signal. */
export default function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
