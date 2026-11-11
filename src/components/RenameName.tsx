"use client";

import { useTransition } from "react";
import { renameAsset } from "@/app/actions";
import { Pencil } from "@/components/icons";

/** Shows an item's name with a pencil button that renames it (used for products and avatars). */
export default function RenameName({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const shown = name.replace(/\.[a-z0-9]+$/i, "");
  const rename = () => {
    const next = window.prompt("Name (used by the AI in your video's script):", shown)?.trim();
    if (!next || next === shown) return;
    start(() => renameAsset(id, next));
  };
  return (
    <button type="button" onClick={rename} disabled={pending} title="Rename"
      className="flex min-w-0 items-center gap-1.5 text-left text-muted hover:text-foreground disabled:opacity-50">
      <span className="truncate">{pending ? "Saving…" : shown || "Add a name"}</span>
      <Pencil className="h-3 w-3 shrink-0 opacity-70" />
    </button>
  );
}
