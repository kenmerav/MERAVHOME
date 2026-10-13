import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { canReconnectMarvinInbox } from "@/lib/permissions";
import { reconnectMarvinInbox } from "@/lib/eaWorkspaceClient";
import { toast } from "sonner";

export const Route = createFileRoute("/construction-uploads")({
  head: () => ({ meta: [{ title: "Document Uploads - MERAV Studio" }] }),
  component: ConstructionUploadsPage,
});

type UploadStatus = {
  connection: { status: string; account_email: string; last_error: string | null } | null;
  lastSuccessfulCheck: string | null;
  latestCheck: {
    status: string;
    started_at: string;
    finished_at: string | null;
    error: string | null;
    uploaded: number;
    failed: number;
    deferred: number;
    needsReview: number;
    needsReconnect: boolean;
  } | null;
};

async function uploadRequest(method = "GET") {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in first.");
  const res = await fetch("/api/construction-uploads", {
    method,
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Unable to check document uploads.");
  return body;
}

function dateLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString("en-US", { timeZone: "America/Phoenix" }) + " (Phoenix)"
    : "No completed check yet";
}

function ConstructionUploadsPage() {
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const status = useQuery<UploadStatus>({
    queryKey: ["constructionUploads"],
    queryFn: () => uploadRequest(),
    refetchInterval: 60_000,
  });
  const identity = useQuery({
    queryKey: ["constructionUploadsIdentity"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.email,
  });
  const check = status.data?.latestCheck;
  const googleStatus = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  ).get("gmail");
  const refresh = async () => {
    setBusy(true);
    try {
      const result = await uploadRequest("POST");
      if (result.needsReconnect) toast.error("Ken needs to reconnect Marvin to read new PDFs.");
      else if (result.failed || result.deferred || result.error)
        toast.warning("Some PDFs remain for retry. Check the status below.");
      else toast.success(`${result.uploaded || 0} new construction documents uploaded.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Document refresh failed.");
    } finally {
      setBusy(false);
      void status.refetch();
    }
  };
  return (
    <AppShell>
      <div className="page-pad max-w-4xl space-y-6">
        <div>
          <p className="eyebrow">Construction documents</p>
          <h1 className="mt-2 font-display text-4xl">Automatic uploads</h1>
        </div>
        <p className="text-muted-foreground">
          Jessica’s construction PDFs from Marvin’s inbox are filed into the matching project. The
          EA agent is off: no tasks, drafts or briefings are generated, and nothing is sent to
          anyone.
        </p>
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <p>
            Checks are scheduled daily at 7 AM and noon, Phoenix time. The hosting service can start
            each check within that hour; uploads are not instant.
          </p>
          {googleStatus === "connected" && (
            <p className="text-green-700">Google reconnection completed.</p>
          )}
          {googleStatus === "error" && (
            <p role="alert" className="text-red-700">
              Google reconnection failed. Please try again.
            </p>
          )}
          {status.isLoading ? (
            <p>Loading upload status…</p>
          ) : status.error ? (
            <p role="alert" className="text-red-700">
              {status.error.message}
            </p>
          ) : (
            <>
              <p>
                Marvin connection:{" "}
                <strong>{status.data?.connection?.status || "Not connected"}</strong>
              </p>
              <p>Last successful check: {dateLabel(status.data?.lastSuccessfulCheck ?? null)}</p>
              {check && (
                <p>
                  Latest check: {check.status} · {dateLabel(check.finished_at || check.started_at)}{" "}
                  · {check.uploaded} uploaded
                </p>
              )}
              {check?.error && (
                <p role="alert" className="text-red-700">
                  {check.error}
                </p>
              )}
              {!!check?.needsReview && (
                <p className="text-muted-foreground">
                  Some PDFs have an uncertain project match and were not automatically filed.
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy || status.isLoading || !!status.error}
              onClick={refresh}
              className="bg-ink text-primary-foreground px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Checking PDFs…" : "Check for new PDFs"}
            </button>
            {canReconnectMarvinInbox(identity.data) && !status.error && (
              <button
                disabled={connecting}
                className="border px-4 py-2 disabled:opacity-50"
                onClick={async () => {
                  setConnecting(true);
                  try {
                    window.location.assign(await reconnectMarvinInbox());
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Unable to reconnect.");
                    setConnecting(false);
                  }
                }}
              >
                {connecting ? "Opening Google…" : "Reconnect Marvin"}
              </button>
            )}
            <Link to="/projects" className="border px-4 py-2">
              View projects
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            Existing construction documents remain on each project’s Construction Docs page.
            Uncertain matches are never guessed.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
