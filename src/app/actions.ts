"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const offer = String(formData.get("offer_description") ?? "").trim();
  const aspect = String(formData.get("aspect_ratio") ?? "9:16");
  if (!title) return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ title, offer_description: offer || null, aspect_ratio: aspect })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
  redirect(`/projects/${data.id}`);
}

export async function deleteProject(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { data: files } = await supabase.from("assets").select("storage_path").eq("project_id", id);
  if (files?.length) {
    await supabase.storage.from("media").remove(files.map((f) => f.storage_path));
  }
  await supabase.from("projects").delete().eq("id", id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function deleteAsset(formData: FormData) {
  const id = String(formData.get("id"));
  const projectId = String(formData.get("project_id"));
  const supabase = await createClient();
  const { data } = await supabase.from("assets").select("storage_path, thumb_path").eq("id", id).single();
  if (data) await supabase.storage.from("media").remove([data.storage_path, data.thumb_path].filter((p): p is string => !!p));
  await supabase.from("assets").delete().eq("id", id);
  revalidatePath(`/projects/${projectId}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function startGeneration(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const sceneCount = Math.min(Math.max(Number(formData.get("scene_count") ?? 3), 1), 5);
  const idea = String(formData.get("idea") ?? "").trim().slice(0, 600);
  const supabase = await createClient();

  // RLS guarantees this only returns the caller's own project.
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) throw new Error("Project not found");

  // One generation at a time per project, so a double click can't start two runs.
  const { count } = await supabase
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .in("status", ["queued", "running"]);
  if (count) return;

  // Keep the product/avatar chosen when the project was created.
  const { data: prev } = await supabase
    .from("generation_jobs")
    .select("input")
    .eq("project_id", projectId)
    .eq("job_type", "script")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevIn = (prev?.input ?? {}) as { product_path?: string | null; avatar_path?: string | null; voice?: string | null };
  const voice = formData.has("voice") ? voiceFrom(formData) : (prevIn.voice ?? null);

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({
      project_id: projectId,
      job_type: "script",
      input: {
        scene_count: sceneCount,
        idea,
        product_path: prevIn.product_path ?? null,
        avatar_path: prevIn.avatar_path ?? null,
        model_shot: formData.get("model_shot") === "on",
        voice,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("projects").update({ status: "generating" }).eq("id", projectId);

  const failure = await submitToWorker(job.id);

  if (failure) {
    // Users can't update jobs under RLS, so record the failure on the project instead.
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
    await supabase.from("generation_jobs").delete().eq("id", job.id);
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?error=${encodeURIComponent(failure)}`);
  }
  revalidatePath(`/projects/${projectId}`);
}

const VOICES = ["af_heart", "af_bella", "am_michael", "am_fenrir", "bf_emma", "bm_george"];
/** Talking avatar settings from the form: voice id, or null when the avatar stays silent. */
function voiceFrom(formData: FormData): string | null {
  const v = String(formData.get("voice") ?? "");
  return VOICES.includes(v) ? v : null;
}

async function submitToWorker(jobId: string): Promise<string | null> {
  const url = process.env.WORKER_SUBMIT_URL;
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!url || !secret) return "The GPU worker isn't connected yet (WORKER_SUBMIT_URL is not set).";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ job_id: jobId }),
      cache: "no-store",
    });
    return res.ok ? null : `GPU worker refused the job (${res.status}).`;
  } catch (e) {
    return `Could not reach the GPU worker: ${(e as Error).message}`;
  }
}

/** One-step create: new project from the composer, attach the chosen product/avatar, start the AI. */
export async function createAndGenerate(formData: FormData) {
  // An empty idea is fine: the AI script writer then picks a strong concept for the product/avatar.
  const idea = String(formData.get("idea") ?? "").trim().slice(0, 600);
  const aspect = ["9:16", "16:9", "1:1"].includes(String(formData.get("aspect_ratio"))) ? String(formData.get("aspect_ratio")) : "9:16";
  const sceneCount = Math.min(Math.max(Number(formData.get("scene_count") ?? 1), 1), 5);
  const productId = String(formData.get("product_id") ?? "") || null;
  const avatarId = String(formData.get("avatar_id") ?? "") || null;
  const supabase = await createClient();

  // RLS limits these lookups to the caller's own library.
  const ids = [productId, avatarId].filter(Boolean) as string[];
  const { data: picks } = ids.length
    ? await supabase.from("assets").select("id, storage_path, file_name").in("id", ids)
    : { data: [] as { id: string; storage_path: string; file_name: string | null }[] };
  const productPath = picks?.find((p) => p.id === productId)?.storage_path ?? null;
  const avatarPath = picks?.find((p) => p.id === avatarId)?.storage_path ?? null;

  const productName = picks?.find((p) => p.id === productId)?.file_name?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  const words = (idea || (productName ? `${productName} ad` : "AI ad")).replace(/[^\p{L}\p{N}\s'-]/gu, "").split(/\s+/).filter(Boolean);
  const title = words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
  const { data: project, error } = await supabase
    .from("projects")
    .insert({ title: title || "New ad", offer_description: idea || productName || null, aspect_ratio: aspect, status: "generating" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: job, error: jobErr } = await supabase
    .from("generation_jobs")
    .insert({
      project_id: project.id,
      job_type: "script",
      input: {
        scene_count: sceneCount,
        idea,
        // Generic names ("Amazon product", "IMG_1234") make the script say them out loud, so skip them.
        product_name: productName && !/^(amazon product|product from |img[_-]?\d|image|photo|screenshot)/i.test(productName) ? productName : null,
        product_path: productPath,
        avatar_path: avatarPath,
        model_shot: !!productPath && (formData.get("model_shot") === "on" || !!avatarPath),
        voice: voiceFrom(formData),
      },
    })
    .select("id")
    .single();
  if (jobErr) throw new Error(jobErr.message);

  const failure = await submitToWorker(job.id);
  if (failure) {
    await supabase.from("projects").update({ status: "failed" }).eq("id", project.id);
    await supabase.from("generation_jobs").delete().eq("id", job.id);
  }
  revalidatePath("/dashboard");
  redirect(`/projects/${project.id}${failure ? `?error=${encodeURIComponent(failure)}` : ""}`);
}

export async function toggleLike(formData: FormData) {
  const id = String(formData.get("id"));
  const liked = formData.get("liked") === "true";
  const supabase = await createClient();
  await supabase.from("assets").update({ liked: !liked }).eq("id", id);
  revalidatePath("/media");
}

export async function deleteLibraryItem(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { data } = await supabase.from("assets").select("storage_path, thumb_path").eq("id", id).single();
  if (data) await supabase.storage.from("media").remove([data.storage_path, data.thumb_path].filter((p): p is string => !!p));
  await supabase.from("assets").delete().eq("id", id);
  revalidatePath("/media");
  revalidatePath("/dashboard");
}

/** Rename a library item (the AI uses a product's name in the script and call to action). */
export async function renameAsset(id: string, name: string) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) return;
  const supabase = await createClient();
  const { data } = await supabase.from("assets").select("file_name").eq("id", id).single();
  const ext = /\.(jpe?g|png|webp|gif|heic|avif|mp4|mov|webm)$/i.exec(data?.file_name ?? "")?.[0] ?? "";
  await supabase.from("assets").update({ file_name: clean + ext }).eq("id", id);
  revalidatePath("/media");
  revalidatePath("/dashboard");
}

/* ---------- Add a product from a link ---------- */

const UA = "Mozilla/5.0 (compatible; ViralKingAI/1.0; +https://viralkingai.vercel.app)";

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/gi, "/").replace(/\\u002F/gi, "/").trim();
}

function meta(html: string, key: string) {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i").exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i").exec(html);
  return decodeHtml((a ?? b)?.[1] ?? "") || null;
}

/** Find the main product photo and name on a shop page (Shopify, Etsy, WooCommerce, Amazon, most stores). */
function findProduct(html: string) {
  let image =
    meta(html, "og:image:secure_url") ?? meta(html, "og:image") ?? meta(html, "twitter:image") ?? meta(html, "twitter:image:src");
  let name = meta(html, "og:title") ?? meta(html, "twitter:title");
  // Structured product data (schema.org JSON-LD)
  if (!image || !name) {
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const nodes = [JSON.parse(m[1])].flat().flatMap((n) => (n?.["@graph"] ? n["@graph"] : [n]));
        const p = nodes.find((n) => [n?.["@type"]].flat().includes("Product"));
        if (!p) continue;
        const img = [p.image].flat()[0];
        image ??= typeof img === "string" ? img : img?.url ?? null;
        name ??= p.name ?? null;
        break;
      } catch {}
    }
  }
  // Amazon's main image
  image ??= decodeHtml(/data-old-hires=["']([^"']+)["']/i.exec(html)?.[1] ?? /"hiRes":"([^"]+)"/.exec(html)?.[1] ?? "") || null;
  image ??= decodeHtml(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ?? "") || null;
  name ??= decodeHtml(/<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? "") || null;
  return { image, name };
}

function safeUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(h)) return null;
  return u;
}

async function get(url: URL, accept: string) {
  return fetch(url, {
    headers: { "user-agent": UA, accept, "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
}

/** Paste a product page (or a direct photo link): saves the product photo to your Products library. */
export async function addProductFromUrl(raw: string): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const url = safeUrl(raw.trim());
  if (!url) return { error: "That doesn't look like a web link." };

  try {
    let res = await get(url, "text/html,image/*;q=0.9,*/*;q=0.8");
    const amazon = /(^|\.)(amazon(\.[a-z.]+)?|amzn\.(to|eu|asia)|a\.co)$/i.test(url.hostname) && !/media-amazon\.com$/i.test(url.hostname);
    if (!res.ok && amazon) return { error: "Amazon blocks product pages from being read automatically. On the Amazon page, right-click (Mac) or press and hold (iPhone) the main photo, choose Copy Image Address, and paste that here instead." };
    if (!res.ok) return { error: `That site refused the request (${res.status}). Save the product photo and use Upload instead.` };
    let name: string | null = null;

    if (!res.headers.get("content-type")?.startsWith("image/")) {
      const html = (await res.text()).slice(0, 3_000_000);
      const found = findProduct(html);
      if (!found.image) return { error: "Couldn't find a product photo on that page. Save the photo and use Upload instead." };
      name = found.name;
      const imgUrl = safeUrl(new URL(found.image, res.url).toString());
      if (!imgUrl) return { error: "Couldn't load that product photo." };
      res = await get(imgUrl, "image/*");
      if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return { error: "Couldn't download that product photo. Save it and use Upload instead." };
    }

    const type = res.headers.get("content-type")!.split(";")[0];
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 20_000_000) return { error: "That photo is over 20 MB." };
    if (bytes.byteLength < 2_000) return { error: "That photo is too small to use." };
    const ext = type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
    const site = url.hostname.replace(/^www\./, "").replace(/^(m\.)?media-amazon\.com$|images-amazon\.com$/, "amazon.com");
    const title = (name ?? `Product from ${site}`).replace(/\s+/g, " ").slice(0, 80);
    const path = `${user.id}/library/${crypto.randomUUID()}-link.${ext}`;

    const { error: upErr } = await supabase.storage.from("media").upload(path, bytes, { contentType: type });
    if (upErr) return { error: upErr.message };
    const { data, error } = await supabase
      .from("assets")
      .insert({ kind: "product", storage_path: path, file_name: title, mime_type: type, size_bytes: bytes.byteLength })
      .select("id")
      .single();
    if (error) {
      await supabase.storage.from("media").remove([path]);
      return { error: error.message };
    }
    revalidatePath("/dashboard");
    revalidatePath("/media");
    return { id: data.id as string };
  } catch (e) {
    return { error: (e as Error).name === "TimeoutError" ? "That site took too long to answer." : "Couldn't open that link." };
  }
}
