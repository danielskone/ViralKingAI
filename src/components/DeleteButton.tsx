"use client";

import { Trash } from "@/components/icons";

/** Trash button that asks "are you sure?" before submitting a delete server action. */
export default function DeleteButton({
  action, fields, label = "this", className, iconClass = "h-4 w-4", text,
}: {
  action: (fd: FormData) => Promise<void>;
  fields: Record<string, string>;
  label?: string;
  className?: string;
  iconClass?: string;
  text?: string;
}) {
  return (
    <form action={action} onSubmit={(e) => { if (!confirm(`Delete ${label}? This can't be undone.`)) e.preventDefault(); }}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button title="Delete" className={className ?? "flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-foreground backdrop-blur hover:text-danger"}>
        <Trash className={iconClass} />{text}
      </button>
    </form>
  );
}
