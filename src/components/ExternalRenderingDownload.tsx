import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { RoomImage } from "@/lib/db";
import {
  buildExternalRenderingZip,
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
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const entries = renderingDownloadEntries(projectName, rooms, images);
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
    <div>
      <button
        type="button"
        className="inline-flex items-center gap-2 border border-ink px-4 py-2 text-sm disabled:opacity-50"
        disabled={busy || !entries.length}
        onClick={() => void download()}
        title={
          entries.length
            ? `${entries.length} approved renderings · named by project and room`
            : "No approved renderings to download"
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {busy ? `Preparing ${completed} of ${entries.length}…` : "Download approved renderings"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-md text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
