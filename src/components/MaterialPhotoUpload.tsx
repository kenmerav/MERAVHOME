import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import type { MaterialItem } from "@/lib/db";
import { materialImageUrl } from "@/lib/materialImages";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { uploadMaterialPhoto } from "@/lib/materialPhotoUpload";

export function MaterialPhotoUpload({
  item,
  projectId,
}: {
  item: MaterialItem;
  projectId: string;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const imageUrl = materialImageUrl(item);

  const upload = async (file?: File) => {
    if (!file || working) return;
    setWorking(true);
    try {
      await uploadMaterialPhoto(file, projectId, item.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["materialItems", projectId] }),
        qc.invalidateQueries({ queryKey: ["procurement"] }),
      ]);
      toast.success(`Picture added to ${item.item_label}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not upload this picture. Please try again.",
      );
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="mt-2 pl-3.5">
      <button
        type="button"
        disabled={working}
        aria-label={`${imageUrl ? "Change" : "Add"} photo for ${item.item_label}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files[0]);
        }}
        className={`flex items-center gap-2 text-xs text-muted-foreground hover:text-ink disabled:opacity-50 ${dragging ? "outline outline-1 outline-ink" : ""}`}
        title="Upload a picture or drag one here"
      >
        {imageUrl ? (
          <img
            src={normalizeSupabaseImageUrl(imageUrl)}
            alt={item.item_label}
            loading="lazy"
            className="h-10 w-10 shrink-0 border border-border bg-bone object-contain"
          />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-dashed border-border bg-bone">
            <Upload className="h-4 w-4" />
          </span>
        )}
        <span className="underline underline-offset-4">
          {working ? "Uploading…" : imageUrl ? "Change photo" : "Add photo"}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label={`Upload photo for ${item.item_label}`}
        onChange={(event) => void upload(event.target.files?.[0])}
      />
    </div>
  );
}
