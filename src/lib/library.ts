import type { SupabaseClient } from "@supabase/supabase-js";

export type LibItem = {
  id: string;
  kind: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  project_id: string | null;
  liked: boolean;
  created_at: string;
  url?: string;
};

/** Attach short-lived signed URLs (the media bucket is private). */
export async function withUrls<T extends { storage_path: string }>(supabase: SupabaseClient, rows: T[]) {
  if (!rows.length) return rows.map((r) => ({ ...r, url: undefined as string | undefined }));
  const { data } = await supabase.storage.from("media").createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const map = new Map<string, string>();
  data?.forEach((d) => d.path && d.signedUrl && map.set(d.path, d.signedUrl));
  return rows.map((r) => ({ ...r, url: map.get(r.storage_path) }));
}

export const isVideo = (kind: string, mime?: string | null) =>
  kind === "video" || kind === "generated_clip" || kind === "export" || !!mime?.startsWith("video/");
