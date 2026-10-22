import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RoomImage } from "@/lib/db";
import {
  buildExternalRenderingZip,
  externalRenderingCandidates,
  renderingDownloadEntries,
} from "@/lib/externalRenderingDownload";

export function ExternalRenderingDownload({
  projectName,
  rooms,
  images,
}: {
  projectName: string;
  rooms: Array<{ id: string; name: string; sort_order?: number }>;
  images: RoomImage[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const candidates = useMemo(() => externalRenderingCandidates(images, rooms), [images, rooms]);
  const external = candidates.filter((image) => image.rendering_source === "external");
  const older = candidates.filter((image) => image.rendering_source == null);
  const entries = renderingDownloadEntries(projectName, rooms, candidates, selected);
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const chooseAll = (items: RoomImage[], checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const image of items) {
        if (checked) next.add(image.id);
        else next.delete(image.id);
      }
      return next;
    });
  const list = (items: RoomImage[]) =>
    rooms.map((room) => {
      const roomImages = items.filter((image) => image.room_id === room.id);
      if (!roomImages.length) return null;
      return (
        <div key={room.id} className="border border-border bg-background">
          <h3 className="bg-bone/50 px-3 py-2 font-semibold">{room.name}</h3>
          <div className="divide-y divide-border">
            {roomImages.map((image) => (
              <label key={image.id} className="flex cursor-pointer items-start gap-3 p-3 text-sm">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.has(image.id)}
                  onChange={(event) => toggle(image.id, event.target.checked)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words">{image.caption || "Rendering"}</span>
                  {selected.has(image.id) && (
                    <span className="mt-1 block break-words text-xs text-muted-foreground">
                      {entries.find((entry) => entry.image.id === image.id)?.filenameStem} ·
                      original image format
                    </span>
                  )}
                </span>
                <a
                  href={image.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs underline"
                >
                  View image ↗
                </a>
              </label>
            ))}
          </div>
        </div>
      );
    });
  const download = async () => {
    setBusy(true);
    setError("");
    setCompleted(0);
    try {
      const result = await buildExternalRenderingZip(projectName, entries, setCompleted);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare the download. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) {
          setSelected(new Set(external.map((image) => image.id)));
          setError("");
          setCompleted(0);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 border border-ink px-4 py-2 text-sm"
          disabled={!candidates.length}
        >
          <Download className="h-4 w-4" />
          Download external renderings
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            Download external renderings
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Choose the uploaded renderings to download as one ZIP. Images keep their original format
          and use Project Name Room Name 1, 2, 3. Numbering starts again for each room.
        </p>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {external.length > 0 && (
            <section className="space-y-3" aria-label="External rendering uploads">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">External uploads ({external.length})</h2>
                <button
                  className="text-xs underline"
                  disabled={busy}
                  onClick={() =>
                    chooseAll(external, !external.every((image) => selected.has(image.id)))
                  }
                >
                  {external.every((image) => selected.has(image.id))
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>
              {list(external)}
            </section>
          )}
          {older.length > 0 && (
            <details open={!external.length} className="border border-border p-3">
              <summary className="cursor-pointer font-semibold">
                Older renderings · choose images to include ({older.length})
              </summary>
              <p className="my-3 text-sm text-muted-foreground">
                Older images weren’t labeled as uploaded or generated. Review these images and
                select only the external uploads you want. Selecting them here doesn’t change their
                saved details.
              </p>
              <button
                type="button"
                disabled={busy}
                className="mb-3 text-xs underline"
                onClick={() => chooseAll(older, !older.every((image) => selected.has(image.id)))}
              >
                {older.every((image) => selected.has(image.id))
                  ? "Deselect older images"
                  : "Select all older images"}
              </button>
              <div className="space-y-3">{list(older)}</div>
            </details>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm">
            Preparing {completed} of {entries.length} images…
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">{entries.length} images selected</span>
          <Button onClick={() => void download()} disabled={busy || !entries.length}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download ZIP
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
