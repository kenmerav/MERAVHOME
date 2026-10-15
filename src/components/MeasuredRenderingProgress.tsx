import { useEffect, useState } from "react";

export type RenderingProgressJob = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  error?: string;
  sourceCitation?: { sheet: string; title: string; page: number };
};
export function elapsedJobTime(startedAt: string | undefined, now: number) {
  const start = Date.parse(startedAt || "");
  if (!Number.isFinite(start)) return "Starting…";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
export function MeasuredRenderingProgress({
  job,
  busy,
  startedAt,
  lastCheckedAt,
  checking,
  statusError,
  previousView,
  onCheck,
  onNext,
  nextLabel,
  onUseSavedCamera,
}: {
  job: RenderingProgressJob | null;
  busy: string;
  startedAt: string;
  lastCheckedAt: string;
  checking: boolean;
  statusError: string;
  previousView: boolean;
  onCheck?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  onUseSavedCamera?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const pending = !!busy || (!!job && !["complete", "failed"].includes(job.status));
  useEffect(() => {
    setNow(Date.now());
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending, job?.id, startedAt]);
  const photo = (job?.kind || busy) === "photoreal";
  const starting = job?.status === "starting";
  const unknown = job?.status === "unknown";
  const completed = job?.status === "complete" && !busy;
  const failed = job?.status === "failed" && !busy;
  const title = unknown
    ? `${photo ? "Image" : "Drawing"} request needs a status check`
    : failed
      ? "This job stopped"
      : completed
        ? photo
          ? "Image ready for review"
          : "Drawing ready for review"
        : busy === "camera"
          ? "Saving the camera view"
          : busy === "upload"
            ? "Saving drawing references"
            : busy === "loading"
              ? "Loading saved work"
              : starting
                ? `Saving your ${photo ? "image" : "drawing"} request`
                : job?.status === "queued"
                  ? photo
                    ? "Waiting for the image creator"
                    : "Waiting for the drawing reader"
                  : photo
                    ? "Creating the finished-room image"
                    : "Reading dimensions and matching Spec Book products";
  const clockStart =
    busy && !["interpret", "photoreal"].includes(busy) ? startedAt : job?.createdAt || startedAt;
  const elapsed = now - Date.parse(clockStart);
  const checked = Math.max(0, Math.floor((now - Date.parse(lastCheckedAt)) / 1000));
  return (
    <section
      aria-label="Rendering progress"
      className="mb-6 border border-stone-300 bg-stone-50 p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">
            {photo ? "Photorealistic image" : "Drawing → measured view"}
          </p>
          <div role="status" className="flex items-center gap-3">
            {pending && !unknown && (
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full border-2 border-stone-300 border-t-stone-800 animate-spin motion-reduce:animate-none"
              />
            )}
            <h2 className="font-display text-2xl">{title}</h2>
          </div>
          {job?.sourceCitation && (
            <p className="mt-2 text-xs">
              {job.sourceCitation.sheet} · {job.sourceCitation.title} · PDF page{" "}
              {job.sourceCitation.page}
            </p>
          )}
        </div>
        {pending && (
          <p className="text-sm tabular-nums" aria-live="off">
            Elapsed {elapsedJobTime(clockStart, now)}
          </p>
        )}
      </div>
      <p className="mt-3 text-sm">
        {unknown
          ? "The start could not be confirmed. Check the saved request before trying another read."
          : failed
            ? "Your source drawing and saved work are kept. Review the error below before starting another attempt."
            : completed
              ? photo
                ? "Review the image against your drawing and selected products."
                : "Review the measured view and product matches. Then save the camera view."
              : busy === "camera"
                ? "Saving the measured view, camera and references."
                : ["upload", "loading"].includes(busy)
                  ? "The next step will unlock when this finishes."
                  : "Detailed drawings can take several minutes. The service does not provide an exact finish time or percentage."}
      </p>
      {job && !starting && !unknown && pending && (
        <p className="mt-2 text-xs text-muted-foreground">
          Saved status: {job.status === "processing" ? "In progress" : "Waiting to start"}.
          {lastCheckedAt && Number.isFinite(checked)
            ? ` Last checked ${checked < 5 ? "just now" : `${checked}s ago`}.`
            : " Checking saved status…"}{" "}
          You can close this page or choose another room; the job continues in the background.
        </p>
      )}
      {previousView && pending && busy === "interpret" && (
        <p className="mt-2 text-xs">
          The preview below is your previous saved view. This drawing read will replace it when
          ready.
        </p>
      )}
      {elapsed >= 10 * 60_000 && pending && (
        <p className="mt-3 text-sm">
          This is taking longer than usual. Keep checking this saved job before starting another
          attempt.
        </p>
      )}
      {statusError && (
        <p role="alert" className="mt-3 text-sm text-amber-900">
          {statusError}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {onCheck && (
          <button
            type="button"
            disabled={checking}
            onClick={onCheck}
            className="border border-stone-400 px-4 py-2 text-sm disabled:opacity-50"
          >
            {checking ? "Checking status…" : "Check status"}
          </button>
        )}
        {onNext && !pending && !failed && (
          <button type="button" onClick={onNext} className="bg-ink text-white px-4 py-2 text-sm">
            {nextLabel}
          </button>
        )}
        {pending && onUseSavedCamera && (
          <button
            type="button"
            onClick={onUseSavedCamera}
            className="border border-stone-400 px-4 py-2 text-sm"
          >
            Use previous saved camera
          </button>
        )}
        {onCheck && (
          <span className="text-xs text-muted-foreground">
            Checking status does not start another read or image.
          </span>
        )}
      </div>
    </section>
  );
}
