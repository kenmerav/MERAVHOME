import { useState } from "react";
import { Link } from "@tanstack/react-router";

export type SavedMeasuredRendering = {
  id: string;
  caption: string | null;
  review_status: string;
  is_approved: boolean;
};
export function MeasuredRenderingImagePanel({
  projectId,
  imageUrl,
  jobId,
  defaultName,
  notes,
  revisionNotes,
  revisionNumber,
  savedRendering,
  busy,
  revisionBlockedReason,
  onSave,
  onRevise,
  onOpenGallery,
}: {
  projectId: string;
  imageUrl: string;
  jobId?: string;
  defaultName: string;
  notes: string[];
  revisionNotes?: string;
  revisionNumber?: number;
  savedRendering?: SavedMeasuredRendering | null;
  busy: boolean;
  revisionBlockedReason?: string;
  onSave: (caption: string, approve: boolean) => Promise<void>;
  onRevise: (notes: string) => Promise<boolean>;
  onOpenGallery?: () => void;
}) {
  const [caption, setCaption] = useState(savedRendering?.caption || defaultName);
  const [approve, setApprove] = useState(false);
  const [adjustments, setAdjustments] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const disabled = busy || saving || submitting;
  async function save() {
    if (disabled || !caption.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave(caption.trim(), approve);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this image.");
    } finally {
      setSaving(false);
    }
  }
  async function revise() {
    if (disabled || revisionBlockedReason || !adjustments.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      if (await onRevise(adjustments.trim())) setAdjustments("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the adjustment.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section className="mb-8 border bg-white" aria-label="Finished rendering">
      <div className="p-4 flex flex-wrap justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl">Photorealistic presentation</h2>
          <p className="text-xs mt-1 text-muted-foreground">
            {jobId ? `Version ${revisionNumber || 1} · ` : ""}Selected-product references · Requires
            design review
          </p>
        </div>
        <a href={imageUrl} target="_blank" rel="noreferrer" className="text-sm underline">
          Open full image
        </a>
      </div>
      <img
        src={imageUrl}
        alt="Photorealistic room presentation"
        className="w-full max-h-[740px] object-contain"
      />
      <p className="p-4 text-xs text-muted-foreground">
        {notes.join(" ")} The measured scene remains the dimension reference; image generation can
        change fine geometry.
      </p>
      {revisionNotes && (
        <div className="px-4 pb-4 text-sm">
          <strong>Requested adjustments</strong>
          <p className="mt-1 whitespace-pre-wrap">{revisionNotes}</p>
        </div>
      )}
      {jobId ? (
        <div className="border-t grid md:grid-cols-2 gap-6 p-4">
          <div className="space-y-3">
            <h3 className="font-display text-2xl">Save this rendering</h3>
            {savedRendering ? (
              <>
                <p role="status" className="text-sm">
                  Saved to room renderings
                  {savedRendering.caption ? ` as “${savedRendering.caption}”` : ""}.{" "}
                  {savedRendering.is_approved || savedRendering.review_status === "approved"
                    ? "Approved and available in presentations."
                    : "Saved as a draft. Review and approve it in the room gallery when ready."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Saving and reopening an image does not generate another image.
                </p>
              </>
            ) : (
              <>
                <label className="block text-sm" htmlFor="measured-rendering-name">
                  Rendering name
                </label>
                <input
                  id="measured-rendering-name"
                  className="w-full border p-2 text-sm"
                  value={caption}
                  maxLength={200}
                  onChange={(e) => setCaption(e.target.value)}
                  disabled={disabled}
                />
                <label className="flex gap-2 items-start text-sm">
                  <input
                    type="checkbox"
                    checked={approve}
                    onChange={(e) => setApprove(e.target.checked)}
                    disabled={disabled}
                    className="mt-1"
                  />
                  I’ve reviewed this image — approve it for presentations.
                </label>
                <button
                  className="border border-ink px-4 py-2 text-sm disabled:opacity-50"
                  disabled={disabled || !caption.trim()}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save to room renderings"}
                </button>
                <p className="text-xs text-muted-foreground">
                  Keeps the full-quality image. Leave approval unchecked to save a draft. Saving
                  does not use AI credits.
                </p>
              </>
            )}
            {savedRendering && (
              <div className="flex flex-wrap gap-4 text-sm">
                {onOpenGallery && (
                  <button onClick={onOpenGallery} className="underline">
                    View room renderings
                  </button>
                )}
                {(savedRendering.is_approved || savedRendering.review_status === "approved") && (
                  <Link
                    to="/projects/$id/presentation"
                    params={{ id: projectId }}
                    className="underline"
                  >
                    Open project presentation
                  </Link>
                )}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <h3 className="font-display text-2xl">Make adjustments</h3>
            <label className="block text-sm" htmlFor="measured-rendering-adjustments">
              What would you like to change in this image?
            </label>
            <textarea
              id="measured-rendering-adjustments"
              className="w-full border p-3 text-sm min-h-28"
              placeholder="For example: make the wood a little warmer, reduce the glare in the mirror, and keep everything else the same."
              value={adjustments}
              maxLength={4000}
              onChange={(e) => setAdjustments(e.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Creates a new version of the image shown above. Your original and notes stay saved.
              Each submitted adjustment uses image-generation credits. Changes here do not update
              the Spec Book or measured drawing.
            </p>
            <button
              className="bg-ink text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
              disabled={disabled || !!revisionBlockedReason || !adjustments.trim()}
              onClick={() => void revise()}
            >
              {submitting
                ? "Starting…"
                : busy
                  ? "Rendering in progress…"
                  : "Create adjusted version"}
            </button>
            {revisionBlockedReason && (
              <p role="status" className="text-sm text-amber-900">
                {revisionBlockedReason}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="p-4 border-t text-sm">
          This reference sample has no generated job to save or adjust. Create a photorealistic
          image from a saved camera first.
        </p>
      )}
      {error && (
        <p role="alert" className="p-4 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
