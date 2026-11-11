import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/actions";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import SidebarNav from "@/components/SidebarNav";
import { Crown, LogOut, Menu } from "@/components/icons";

export function Wordmark({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <Crown />
      <span className="font-display text-lg font-bold tracking-tight">
        Viral<span className="gold-text">King</span>
      </span>
    </Link>
  );
}

/** Logged-in layout: gold/black sidebar on desktop, a collapsible menu on phones. */
export default async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [user, { data: projects }] = await Promise.all([
    getSessionUser(),
    supabase.from("projects").select("id, title").order("updated_at", { ascending: false }).limit(12),
  ]);
  return <ShellFrame email={user?.email} projects={projects ?? []}>{children}</ShellFrame>;
}

export function ShellFrame({ email, projects, children }: { email?: string | null; projects: { id: string; title: string }[]; children: React.ReactNode }) {
  const sidebar = (
    <>
      <Suspense fallback={<div className="flex-1" />}>
        <SidebarNav projects={projects} />
      </Suspense>
      <div className="mt-4 border-t border-border pt-4">
        <p className="truncate px-3 text-xs text-muted" title={email ?? ""}>{email}</p>
        <form action={signOut}>
          <button className="nav-item mt-1 w-full text-muted"><LogOut className="h-4 w-4" /> Sign out</button>
        </form>
      </div>
    </>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-panel p-4 md:flex">
        <div className="px-2 pb-6"><Wordmark /></div>
        {sidebar}
      </aside>
      <details className="group border-b border-border bg-panel md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <Wordmark />
          <Menu className="h-6 w-6 text-muted" />
        </summary>
        <div className="flex max-h-[80vh] flex-col p-4 pt-0">{sidebar}</div>
      </details>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
