import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

const RUNNER = "http://127.0.0.1:43189";
export type LocalCartAccess = { runId: string; authorization: string; expiresAt: string };
export type RunnerApproval = {
  id: string;
  kind: "questions" | "approval" | "pause";
  message?: string;
  questions?: Array<{
    id: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
  }>;
  schema?: {
    properties?: Record<
      string,
      { type: "string" | "boolean"; title?: string; description?: string; enum?: string[] }
    >;
    required?: string[];
  };
};
export type LocalCartRun = {
  id: string;
  status:
    | "starting"
    | "running"
    | "needs_attention"
    | "finished"
    | "failed"
    | "stopped"
    | "interrupted";
  messages: string[];
  approvals: RunnerApproval[];
};
const finished = (status?: string) =>
  ["finished", "failed", "stopped", "interrupted"].includes(status || "");

async function runnerRequest<T>(
  path: string,
  access?: LocalCartAccess,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${RUNNER}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(access ? { Authorization: `Bearer ${access.authorization}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(body === undefined ? 5000 : 75_000),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "The local cart runner is not reachable. Open it on this computer and allow Studio's local-network connection if Chrome asks.",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.detail || result.error || "The local cart runner could not continue.");
  return result as T;
}

export function useLocalCartRunner(projectId: string, enabled: boolean) {
  const [access, setAccess] = useState<LocalCartAccess | null>(null);
  const [run, setRun] = useState<LocalCartRun | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const storageKey = `merav-cart-runner:${projectId}`;
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (stored?.runId && stored?.authorization && Date.parse(stored.expiresAt) > Date.now())
        setAccess(stored);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* A blocked browser storage setting does not prevent running carts. */
    }
  }, [storageKey]);
  const health = useQuery({
    queryKey: ["localCartRunnerHealth"],
    queryFn: () => runnerRequest<{ version: number; ready: boolean; message: string }>("/health"),
    enabled,
    retry: false,
    refetchInterval: enabled ? 5000 : false,
  });
  const progress = useQuery({
    queryKey: ["localCartRunnerRun", access?.runId],
    queryFn: () => runnerRequest<LocalCartRun>(`/runs/${access!.runId}`, access!),
    enabled: enabled && !!access && !finished(run?.status),
    retry: false,
    refetchInterval: enabled && access && !finished(run?.status) ? 2000 : false,
  });
  useEffect(() => {
    if (progress.data) setRun(progress.data);
  }, [progress.data]);
  useEffect(() => {
    if (finished(run?.status)) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Optional tab recovery. */
      }
    }
  }, [run?.status, storageKey]);
  const start = async (nextAccess: LocalCartAccess) => {
    setBusy(true);
    setError("");
    setRun(null);
    setAccess(nextAccess);
    try {
      // This is tab recovery only; Studio remains the source of truth for results.
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(nextAccess));
      } catch {
        /* Optional. */
      }
      const result = await runnerRequest<LocalCartRun>("/runs", nextAccess, {
        runId: nextAccess.runId,
        authorizeRetailerSites: true,
      });
      setRun(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the local runner.";
      setError(
        `${message} Your prepared run is saved in Studio. Use Build These Carts to try connecting again; do not prepare a duplicate run.`,
      );
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!access) return;
    setBusy(true);
    setError("");
    try {
      setRun(await runnerRequest<LocalCartRun>(`/runs/${access.runId}/stop`, access, {}));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not stop the runner. Cancel the run in Studio to revoke its access.",
      );
    } finally {
      setBusy(false);
    }
  };
  const answer = async (body: unknown) => {
    if (!access) return;
    setBusy(true);
    setError("");
    try {
      setRun(await runnerRequest<LocalCartRun>(`/runs/${access.runId}/answer`, access, body));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not submit the answer.");
    } finally {
      setBusy(false);
    }
  };
  return {
    ready: health.data?.version === 1 && health.data.ready && !health.isError,
    health,
    run,
    access,
    error:
      error ||
      (progress.isError
        ? "Runner connection lost. Reconnect or cancel the run in Studio; do not start a duplicate."
        : ""),
    busy,
    active: !!run && !finished(run.status),
    start,
    stop,
    answer,
  };
}
