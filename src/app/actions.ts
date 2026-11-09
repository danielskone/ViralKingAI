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
