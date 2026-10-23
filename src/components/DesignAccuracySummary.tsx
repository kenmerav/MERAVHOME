import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { accuracyProgress } from "@/lib/designAccuracy";

/** Live design status is distinct from individually dismissed legacy audit findings. */
export function DesignAccuracySummary({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["design-accuracy-status", projectId],
    queryFn: async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await fetch(
        `/api/design-accuracy?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if ([403, 404, 503].includes(response.status)) return null;
      if (!response.ok) throw new Error("Current design decision status could not be checked.");
      return (await response.json()) as {
        enabled: boolean;
        progress?: ReturnType<typeof accuracyProgress>;
      };
    },
    refetchOnWindowFocus: "always",
  });
  if (query.error)
    return (
      <p role="alert" className="mb-4 text-sm text-amber-900">
        Current design decision status is unavailable. Retry before relying on a completion claim.
      </p>
    );
  if (!query.data?.enabled || !query.data.progress) return null;
  const progress = query.data.progress;
  return (
    <aside className="mb-4 border border-border bg-bone/30 p-4 text-sm">
      <p>
        <strong>
          Merav design:{" "}
          {progress.designComplete ? "Complete for confirmed scope" : "Decisions outstanding"}
        </strong>
      </p>
      <p className="mt-2">
        {progress.resolved} / {progress.total} applicable requirements resolved · Drawing
        coordination:{" "}
        {progress.drawing === "checked-requirements-only"
          ? "Matches checked requirements only"
          : progress.drawing}{" "}
        · {progress.external.length} external / field dependencies.
      </p>
      <p className="mt-2">
        Resolving an audit finding below does not confirm design scope or clear a drawing conflict.
      </p>
      <a
        className="mt-2 inline-block underline"
        href={`/projects/${encodeURIComponent(projectId)}/room-design`}
      >
        Review current design decisions
      </a>
    </aside>
  );
}
