"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveThumb } from "@/lib/thumbs";

function kindFor(file: File, asLogo: boolean) {
  if (asLogo) return "logo";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

export default function Uploader({ projectId, userId }: { projectId: string; userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [asLogo, setAsLogo] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    let done = 0;
    for (const file of Array.from(files)) {
      const kind = kindFor(file, asLogo);
      if (!kind) {
        setMsg(`Skipped ${file.name}: only images, video and audio are supported.`);
        continue;
      }
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${projectId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
      if (upErr) {
        setMsg(`Upload failed for ${file.name}: ${upErr.message}`);
        continue;
      }
      const { data: row, error: dbErr } = await supabase.from("assets").insert({
        project_id: projectId,
        kind,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      }).select("id").single();
      if (dbErr) {
        await supabase.storage.from("media").remove([path]);
        setMsg(`Could not save ${file.name}: ${dbErr.message}`);
        continue;
      }
      if (file.type.startsWith("image/")) await saveThumb(supabase, userId, row.id, file);
      done++;
    }
    setBusy(false);
    if (done) router.refresh();
  }

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-5 transition hover:border-gold/60">
      <label className="flex cursor-pointer flex-col items-center gap-2 text-center">
        <span className="font-semibold">{busy ? "Uploading…" : "Upload photos, video, audio or a logo"}</span>
        <span className="text-sm text-muted">Click to choose files (up to 500 MB each)</span>
        <input
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <label className="mt-3 flex items-center justify-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={asLogo} onChange={(e) => setAsLogo(e.target.checked)} />
        These files are my logo
      </label>
      {msg && <p className="mt-3 text-center text-sm text-danger">{msg}</p>}
    </div>
  );
}
