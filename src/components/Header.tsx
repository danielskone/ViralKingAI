import Link from "next/link";
import { signOut } from "@/app/actions";

export function Wordmark({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="font-display text-xl font-semibold tracking-tight text-white">
      Viral<span className="text-accent">King</span>
      <span className="ml-1 text-white/50">AI</span>
    </Link>
  );
}

export const Logo = Wordmark;

export default function Header({ email }: { email?: string | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Wordmark />
        <nav className="hidden items-center gap-8 text-sm text-white/60 md:flex">
          <Link href="/dashboard" className="hover:text-white">Projects</Link>
        </nav>
        <div className="flex items-center gap-3 text-sm text-white/60">
          {email && <span className="hidden sm:inline">{email}</span>}
          <form action={signOut}>
            <button className="pill-ghost">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
