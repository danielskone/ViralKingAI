import Link from "next/link";
import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/server";
import { createProject } from "@/app/actions";

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, offer_description, aspect_ratio, status, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <>
      <Header email={user?.email} />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="mb-1 text-xl font-semibold">Create a video</h2>
          <p className="mb-4 text-sm text-muted">Describe the offer. You&apos;ll add photos and your logo on the next screen.</p>
          <form action={createProject} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto_auto]">
            <input name="title" className="input" placeholder="Project name, e.g. Summer sale" required />
            <input name="offer_description" className="input" placeholder="What are you promoting? e.g. 20% off all smoothies this week" />
            <select name="aspect_ratio" className="input" defaultValue="9:16">
              <option value="9:16">Vertical 9:16</option>
              <option value="16:9">Landscape 16:9</option>
              <option value="1:1">Square 1:1</option>
            </select>
            <button className="btn">Create</button>
          </form>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-semibold">Your projects</h2>
          {!projects?.length ? (
            <p className="text-sm text-muted">No projects yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="rounded-xl border border-border bg-card p-4 hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{p.title}</h3>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{p.status}</span>
                  </div>
                  {p.offer_description && <p className="mt-2 line-clamp-2 text-sm text-muted">{p.offer_description}</p>}
                  <p className="mt-3 text-xs text-muted">
                    {p.aspect_ratio} · updated {new Date(p.updated_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
