import type { SupabaseClient } from "@supabase/supabase-js";

const MAX = 720; // long edge in px: sharp on retina grid tiles, ~40-90 KB each

/** Shrink a photo in the browser to a small WebP preview (falls back to JPEG). */
export async function makeThumb(src: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.82));
  const blob = (await out("image/webp")) ?? (await out("image/jpeg"));
  if (!blob) throw new Error("Could not make preview");
  return blob;
}

/** Make, upload and record the preview for one asset. Never throws: a missing preview just means the full photo is shown. */
export async function saveThumb(supabase: SupabaseClient, userId: string, assetId: string, src: Blob) {
  try {
    const thumb = await makeThumb(src);
    const ext = thumb.type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/library/thumbs/${assetId}.${ext}`;
    const { error } = await supabase.storage.from("media").upload(path, thumb, { contentType: thumb.type, upsert: true, cacheControl: "31536000" });
    if (error) return false;
    const { error: e2 } = await supabase.from("assets").update({ thumb_path: path }).eq("id", assetId);
    return !e2;
  } catch {
    return false;
  }
}
