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

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({ project_id: projectId, job_type: "script", input: { scene_count: sceneCount } })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("projects").update({ status: "generating" }).eq("id", projectId);

  const url = process.env.WORKER_SUBMIT_URL;
  const secret = process.env.WORKER_SHARED_SECRET;
  let failure: string | null = null;
  if (!url || !secret) {
    failure = "The GPU worker isn't connected yet (WORKER_SUBMIT_URL is not set).";
  } else {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ job_id: job.id }),
        cache: "no-store",
      });
      if (!res.ok) failure = `GPU worker refused the job (${res.status}).`;
    } catch (e) {
      failure = `Could not reach the GPU worker: ${(e as Error).message}`;
    }
  }

  if (failure) {
    // Users can't update jobs under RLS, so record the failure on the project instead.
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
    await supabase.from("generation_jobs").delete().eq("id", job.id);
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?error=${encodeURIComponent(failure)}`);
  }
  revalidatePath(`/projects/${projectId}`);
}
