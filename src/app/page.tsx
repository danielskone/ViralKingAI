import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Viral<span className="text-accent">Reel</span> AI
      </h1>
      <p className="text-lg text-muted">
        Turn your ideas, product photos and existing videos into branded social content.
      </p>
      <Link href="/login" className="btn">Sign in</Link>
    </main>
  );
}
