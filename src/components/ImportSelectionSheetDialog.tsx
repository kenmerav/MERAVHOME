import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Room } from "@/lib/db";
import {
  parseSelectionSheet,
  selectedSheetStatus,
  SOURCE_ROOM_TARGET,
  type SelectionSheetRow,
} from "@/lib/selectionSheetImport";
import { importSelectionSheet } from "@/lib/selectionSheetImportClient";

export function ImportSelectionSheetDialog({
  projectId,
  rooms,
  onImport,
  disabled = false,
}: {
  projectId: string;
  rooms: Room[];
  onImport: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SelectionSheetRow[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const selected = useMemo(
    () => rows.filter((row) => included.has(row.sourceId)),
    [rows, included],
  );
  const areas = useMemo(() => [...new Set(selected.map((row) => row.room))], [selected]);
  const ready = selected.length > 0 && areas.every((area) => mapping[area]?.length);
  const load = async (file: File | undefined) => {
    setRows([]);
    setIncluded(new Set());
    setMapping({});
    setError("");
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Use a CSV smaller than 2 MB.");
      const parsed = parseSelectionSheet(await file.text());
      if (parsed.length > 1000) throw new Error("Import up to 1,000 selections at a time.");
      setRows(parsed);
      setIncluded(
        new Set(parsed.filter((row) => selectedSheetStatus(row.status)).map((row) => row.sourceId)),
      );
      setMapping(
        Object.fromEntries(
          [...new Set(parsed.map((row) => row.room))].map((area) => [
            area,
            rooms.some((room) => room.name.trim().toLowerCase() === area.toLowerCase())
              ? rooms
                  .filter((room) => room.name.trim().toLowerCase() === area.toLowerCase())
                  .map((room) => room.id)
              : [SOURCE_ROOM_TARGET],
          ]),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the CSV.");
    }
  };
  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    setProgress("Preparing selections...");
    try {
      const result = await importSelectionSheet(projectId, selected, mapping, (saved, total) =>
        setProgress(`Saving ${saved} of ${total} entries...`),
      );
      toast.success(
        `Imported ${result.saved} entries (${result.created} new, ${result.updated} existing).`,
      );
      setOpen(false);
      setRows([]);
      setIncluded(new Set());
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "Import failed."} Entries already saved will be matched when you retry.`,
      );
    } finally {
      setBusy(false);
      setProgress("");
      onImport();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-2 px-5 py-3 border border-ink text-ink text-sm tracking-wide"
        >
          <Upload className="w-4 h-4" /> Import Selections
        </button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-5xl max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Import selections from a sheet</DialogTitle>
          <DialogDescription>
            Download the Selections tab as CSV, then choose the entries and rooms. Missing details
            stay blank. Existing entries and filled fields are preserved.
          </DialogDescription>
        </DialogHeader>
        <label className="block text-sm">
          Selections CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => {
              void load(event.target.files?.[0]);
              event.target.value = "";
            }}
            className="block mt-2"
          />
        </label>
        {rows.length > 0 && (
          <>
            <p className="text-sm">
              {selected.length} of {rows.length} selections included. Selected and purchased entries
              are checked; decisions, conflicts, and quote options remain unchecked.
            </p>
            <div className="max-h-64 overflow-auto border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary text-left">
                    <th className="p-2">Include</th>
                    <th className="p-2">Area</th>
                    <th className="p-2">Product</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.sourceId} className="border-t border-border">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`Include ${row.sourceId}`}
                          checked={included.has(row.sourceId)}
                          disabled={busy}
                          onChange={(event) =>
                            setIncluded((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(row.sourceId);
                              else next.delete(row.sourceId);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="p-2">{row.room}</td>
                      <td className="p-2">
                        {row.name}
                        <span className="block text-xs text-muted-foreground">{row.finish}</span>
                      </td>
                      <td className="p-2">{row.status}</td>
                      <td className="p-2">
                        {row.productUrl && (
                          <a
                            href={row.productUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            Product
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="font-medium mb-2">Assign project rooms</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Choose every room that uses each selection. For a stated quantity, choose one room
                so the total is counted once. Areas such as “Kitchen island” can be assigned to
                Kitchen. Keep the source name to create a missing room during import.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {areas.map((area) => (
                  <fieldset key={area} className="border border-border p-3">
                    <legend className="px-1 text-sm font-medium">{area}</legend>
                    <div className="max-h-28 overflow-auto space-y-1">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={mapping[area]?.includes(SOURCE_ROOM_TARGET) ?? false}
                          onChange={(event) =>
                            setMapping((current) => ({
                              ...current,
                              [area]: event.target.checked ? [SOURCE_ROOM_TARGET] : [],
                            }))
                          }
                        />
                        Keep source name: {area}
                      </label>
                      {rooms.map((room) => (
                        <label key={room.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={mapping[area]?.includes(room.id) ?? false}
                            onChange={(event) =>
                              setMapping((current) => ({
                                ...current,
                                [area]: event.target.checked
                                  ? [
                                      ...(current[area] ?? []).filter(
                                        (id) => id !== SOURCE_ROOM_TARGET,
                                      ),
                                      room.id,
                                    ]
                                  : (current[area] ?? []).filter((id) => id !== room.id),
                              }))
                            }
                          />
                          {room.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!ready || busy}
            className="bg-ink text-primary-foreground px-5 py-3 text-sm disabled:opacity-50"
          >
            {busy ? progress : `Import ${selected.length} selections`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
