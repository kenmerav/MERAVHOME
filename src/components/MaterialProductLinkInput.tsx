import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { saveAndScrapeMaterialLink } from "@/lib/materialProductLink";
import type { SavedCompletionIssue } from "@/lib/savedSpecCompletion";
import { toast } from "sonner";

export function MaterialProductLinkInput({ projectId, roomId, label, existingItem, issue, disabled, onSaved }: {
  projectId: string; roomId: string; label: string; existingItem?: { id: string; updated_at: string; product_url?: string | null } | null;
  issue?: SavedCompletionIssue; disabled: boolean; onSaved?: () => Promise<void>;
}) {
  const [url, setUrl] = useState(existingItem?.product_url || "");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const qc = useQueryClient();
  const save = async () => {
    if (lock.current || disabled) return;
    lock.current = true; setError(""); setProgress("Saving link…");
    try {
      const result = await saveAndScrapeMaterialLink({ projectId, roomId, label, existingItem, issue, productUrl: url, onProgress: setProgress });
      if (result.warning) { setError(result.warning); toast.warning(result.warning); }
      else toast.success("Product link and available image, price, dimensions and color saved to Materials and the Spec Book.");
      await Promise.all([["materialItems", projectId], ["spec-completion-review", projectId], ["products"], ["catalog"], ["roomProducts", roomId], ["procurement"]].map(queryKey => qc.invalidateQueries({ queryKey })));
      await onSaved?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the product link."); }
    finally { lock.current = false; setProgress(""); }
  };
  return <form className="mt-3 border bg-white p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset disabled={disabled || !!progress} className="flex flex-wrap items-end gap-3">
      <label className="min-w-40 flex-1"><span className="block text-xs font-medium mb-1">Product link</span>
        <input type="url" aria-label={`Product link for ${label}`} placeholder="Paste product link" value={url} onChange={event => setUrl(event.target.value)} required className="h-10 w-full border bg-background px-3 text-sm" />
      </label>
      <button type="submit" className="h-10 bg-ink px-4 text-sm text-white disabled:opacity-50">{progress ? "Getting product info…" : "Save link & get product info"}</button>
    </fieldset>
    <p role={progress ? "status" : undefined} className="mt-2 text-xs text-muted-foreground">{progress || "Automatically gets the image, price, dimensions and color and saves them to Materials and the Spec Book."}</p>
    {error && <p role="alert" className="mt-2 text-xs text-amber-900">{error}</p>}
  </form>;
}
