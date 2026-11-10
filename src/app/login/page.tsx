"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else {
        router.push("/dashboard");
        router.refresh();
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setMsg(error.message);
      else if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else setMsg("Check your email to confirm your account, then sign in.");
    }
    setBusy(false);
  }

  async function reset() {
    if (!email) return setMsg("Enter your email first.");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    setMsg(error ? error.message : "Password reset email sent.");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,61,110,0.22),transparent_60%)]" />
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Viral<span className="text-accent">King</span> <span className="text-white/50">AI</span>
        </h1>
        <p className="text-sm text-muted">{mode === "signin" ? "Sign in to your studio" : "Create your account"}</p>
        <input className="input" type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}</button>
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <div className="flex justify-between text-sm text-muted">
          <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="hover:text-foreground">
            {mode === "signin" ? "Create an account" : "I have an account"}
          </button>
          {mode === "signin" && (
            <button type="button" onClick={reset} className="hover:text-foreground">Forgot password?</button>
          )}
        </div>
      </form>
    </main>
  );
}
