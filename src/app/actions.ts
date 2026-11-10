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
  const { data } = await supabase.from("assets").select("storage_path").eq("id", id).single();
  if (data) await supabase.storage.from("media").remove([data.storage_path]);
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
  const prevIn = (prev?.input ?? {}) as { product_path?: string | null; avatar_path?: string | null };

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
  const idea = String(formData.get("idea") ?? "").trim().slice(0, 600);
  if (!idea) return;
  const aspect = ["9:16", "16:9", "1:1"].includes(String(formData.get("aspect_ratio"))) ? String(formData.get("aspect_ratio")) : "9:16";
  const sceneCount = Math.min(Math.max(Number(formData.get("scene_count") ?? 1), 1), 5);
  const productId = String(formData.get("product_id") ?? "") || null;
  const avatarId = String(formData.get("avatar_id") ?? "") || null;
  const supabase = await createClient();

  // RLS limits these lookups to the caller's own library.
  const ids = [productId, avatarId].filter(Boolean) as string[];
  const { data: picks } = ids.length
    ? await supabase.from("assets").select("id, storage_path").in("id", ids)
    : { data: [] as { id: string; storage_path: string }[] };
  const productPath = picks?.find((p) => p.id === productId)?.storage_path ?? null;
  const avatarPath = picks?.find((p) => p.id === avatarId)?.storage_path ?? null;

  const words = idea.replace(/[^\p{L}\p{N}\s'-]/gu, "").split(/\s+/).filter(Boolean);
  const title = words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
  const { data: project, error } = await supabase
    .from("projects")
    .insert({ title: title || "New ad", offer_description: idea, aspect_ratio: aspect, status: "generating" })
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
        product_path: productPath,
        avatar_path: avatarPath,
        model_shot: !!productPath && (formData.get("model_shot") === "on" || !!avatarPath),
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
  const { data } = await supabase.from("assets").select("storage_path").eq("id", id).single();
  if (data) await supabase.storage.from("media").remove([data.storage_path]);
  await supabase.from("assets").delete().eq("id", id);
  revalidatePath("/media");
}
