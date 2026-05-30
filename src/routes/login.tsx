import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type React from "react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login — MERAV Studio" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate({ to: "/" });
  };

  return (
    <main className="min-h-screen bg-bone flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-md bg-background border border-border p-8 shadow-sm">
        <div className="font-display text-3xl tracking-tight">MERAV</div>
        <div className="eyebrow mt-1 mb-10">Studio Login</div>

        <div className="space-y-5">
          <div>
            <Label className="eyebrow">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div>
            <Label className="eyebrow">Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in..." : "Sign In"}
          </Button>
        </div>
      </form>
    </main>
  );
}
