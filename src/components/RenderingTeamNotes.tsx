import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function RenderingTeamNotes({
  notes,
  disabled,
  onSave,
}: {
  notes: string | null | undefined;
  disabled?: boolean;
  onSave: (notes: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(notes ?? "");
    setSaved(false);
  }, [notes]);

  const changed = draft !== (notes ?? "");

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(draft.trim() ? draft : null);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border bg-bone/20 p-4 space-y-3">
      <div>
        <Label className="eyebrow">Rendering Notes</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Shared notes for the team while reviewing this image. This does not generate a new
          rendering.
        </p>
      </div>
      <Textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setSaved(false);
        }}
        placeholder="Example: good enough for client review, but watch cabinet color on final pass..."
        rows={3}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || saving || !changed}
          onClick={save}
          className="px-4 py-2 bg-ink text-primary-foreground text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Notes"}
        </button>
        {saved && <span className="text-xs text-muted-foreground">Saved</span>}
      </div>
    </div>
  );
}
