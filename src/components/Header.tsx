import Link from "next/link";
import { signOut } from "@/app/actions";

export function Logo() {
  return (
    <Link href="/dashboard" className="text-lg font-bold tracking-tight">
      Viral<span className="text-accent">Reel</span> AI
    </Link>
  );
}

export default function Header({ email }: { email?: string | null }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Logo />
        <div className="flex items-center gap-3 text-sm text-muted">
          {email && <span className="hidden sm:inline">{email}</span>}
          <form action={signOut}>
            <button className="btn-ghost">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
