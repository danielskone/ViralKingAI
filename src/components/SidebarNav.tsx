"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Box, Brand, Folder, Home, Media, Plus, Sparkle, User } from "@/components/icons";

type Project = { id: string; title: string };

export default function SidebarNav({ projects }: { projects: Project[] }) {
  const path = usePathname();
  const tab = useSearchParams().get("tab");
  const on = (href: string, t?: string) =>
    (t ? path === href && tab === t : path === href && (!tab || href !== "/media" || tab === "uploads")) ? " nav-on" : "";

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto text-sm">
      <Link href="/dashboard" className={"nav-item" + on("/dashboard")}><Home /> Create</Link>
      <Link href="/media" className={"nav-item" + on("/media")}><Media /> All media</Link>
      <Link href="/tutorial" className={"nav-item" + on("/tutorial")}><Sparkle /> Tutorial</Link>

      <p className="eyebrow mt-6 mb-1 px-3">Assets</p>
      <Link href="/brand" className={"nav-item" + on("/brand")}><Brand /> Brand kit</Link>
      <Link href="/media?tab=products" className={"nav-item" + on("/media", "products")}><Box /> Products</Link>
      <Link href="/media?tab=avatars" className={"nav-item" + on("/media", "avatars")}><User /> Avatars</Link>

      <div className="mt-6 mb-1 flex items-center justify-between px-3">
        <p className="eyebrow">Projects</p>
        <Link href="/dashboard" title="New project" className="text-muted hover:text-gold"><Plus className="h-4 w-4" /></Link>
      </div>
      {projects.length === 0 && <p className="px-3 text-xs text-muted">No projects yet</p>}
      {projects.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} className={"nav-item" + (path === `/projects/${p.id}` ? " nav-on" : "")}>
          <Folder className="h-4 w-4 shrink-0 text-gold" />
          <span className="truncate">{p.title}</span>
        </Link>
      ))}
    </nav>
  );
}
