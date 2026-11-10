"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload } from "@/components/icons";
import { saveThumb } from "@/lib/thumbs";

/** Upload straight into the user's library (no project): kind is product, avatar, or auto (image/video). */
export async function uploadToLibrary(file: File, userId: string, kind: "product" | "avatar" | "auto") {
  const supabase = createClient();
  const k = kind !== "auto" ? kind : file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
  if (!k) throw new Error("Only images and videos are supported.");
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/library/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  const { data, error: dbErr } = await supabase
    .from("assets")
    .insert({ kind: k, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size })
    .select("id")
    .single();
  if (dbErr) {
    await supabase.storage.from("media").remove([path]);
    throw new Error(dbErr.message);
  }
  if (k !== "video") await saveThumb(supabase, userId, data.id, file);
  return data.id as string;
}

export default function LibraryUpload({ userId, kind, label }: { userId: string; kind: "product" | "avatar" | "auto"; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <label className="group flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 text-center transition hover:border-gold/60 hover:bg-card">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-panel text-gold transition group-hover:scale-105">
        <Upload />
      </span>
      <span className="text-sm font-medium">{busy ? "Uploading…" : label}</span>
      {err && <span className="px-3 text-xs text-danger">{err}</span>}
      <input
        type="file"
        multiple
        accept={kind === "auto" ? "image/*,video/*" : "image/*"}
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          setErr(null);
          try {
            for (const f of files) await uploadToLibrary(f, userId, kind);
            router.refresh();
          } catch (x) {
            setErr((x as Error).message);
          }
          setBusy(false);
        }}
      />
    </label>
  );
}
