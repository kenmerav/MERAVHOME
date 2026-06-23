import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/extension/connect")({
  head: () => ({ meta: [{ title: "Connect Extension — MERAV Studio" }] }),
  component: ExtensionConnectPage,
});

function safeRedirectUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".chromiumapp.org") ? url.toString() : "";
  } catch {
    return "";
  }
}

function ExtensionConnectPage() {
  const [status, setStatus] = useState("Checking Studio login...");
  const [error, setError] = useState("");
  const redirectUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return safeRedirectUrl(new URLSearchParams(window.location.search).get("redirect") ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (!redirectUrl) {
        setError("The extension did not provide a valid connection return URL.");
        setStatus("");
        return;
      }

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        setError("Sign into MERAV Studio in this Chrome profile, then click Connect again from the extension.");
        setStatus("");
        return;
      }

      setStatus("Connecting extension...");
      const response = await fetch("/api/extension/connect-token", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.error || !body.token) {
        setError(body.error || "Could not connect the Studio extension.");
        setStatus("");
        return;
      }

      if (cancelled) return;
      const returnUrl = new URL(redirectUrl);
      returnUrl.hash = new URLSearchParams({
        token: body.token,
        studioUrl: window.location.origin,
        email: body.user?.email || "",
      }).toString();
      window.location.replace(returnUrl.toString());
    }

    connect().catch((connectError) => {
      if (cancelled) return;
      setStatus("");
      setError(connectError instanceof Error ? connectError.message : "Could not connect the Studio extension.");
    });

    return () => {
      cancelled = true;
    };
  }, [redirectUrl]);

  return (
    <main className="min-h-screen bg-bone flex items-center justify-center px-6">
      <section className="w-full max-w-md bg-background border border-border p-8 shadow-sm">
        <div className="font-display text-3xl tracking-tight">MERAV</div>
        <div className="eyebrow mt-1 mb-8">Studio Extension</div>
        <h1 className="font-display text-4xl mb-4">Connect to Studio</h1>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
        {error && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">{error}</p>
            <a href="/login" className="inline-block border border-ink bg-ink px-5 py-2.5 text-sm text-primary-foreground">
              Sign into Studio
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
