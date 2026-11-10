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
  thumb_path?: string | null;
  url?: string;
  thumb?: string;
};

/**
 * Attach short-lived signed URLs (the media bucket is private).
 * `url` is the full file; `thumb` is the small preview when one exists, else the full file.
 */
export async function withUrls<T extends { storage_path: string; thumb_path?: string | null }>(supabase: SupabaseClient, rows: T[]) {
  const paths = [...new Set(rows.flatMap((r) => [r.storage_path, r.thumb_path].filter((x): x is string => !!x)))];
  const map = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage.from("media").createSignedUrls(paths, 3600);
    data?.forEach((d) => d.path && d.signedUrl && map.set(d.path, d.signedUrl));
  }
  return rows.map((r) => {
    const url = map.get(r.storage_path);
    return { ...r, url, thumb: (r.thumb_path && map.get(r.thumb_path)) || url };
  });
}

/** Photos that still need a small preview made (videos are skipped). */
export const needsThumb = (r: { kind: string; mime_type?: string | null; thumb_path?: string | null }) =>
  !r.thumb_path && !isVideo(r.kind, r.mime_type) && ["image", "product", "avatar", "logo"].includes(r.kind);

export const isVideo = (kind: string, mime?: string | null) =>
  kind === "video" || kind === "generated_clip" || kind === "export" || !!mime?.startsWith("video/");
