import type { RoomImage } from "./db";

type DownloadRoom = { id: string; name: string; sort_order?: number };
export type RenderingDownloadEntry = { image: RoomImage; roomName: string; filenameStem: string };

export function safeRenderingFilename(value: string, fallback: string) {
  const safe = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/g, " ")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return safe || fallback;
}

/** Unknown older records require explicit selection; approval is not evidence of origin. */
export function externalRenderingCandidates(images: RoomImage[], rooms: DownloadRoom[]) {
  const roomIds = new Set(rooms.map((room) => room.id));
  return images.filter(
    (image) =>
      roomIds.has(image.room_id) &&
      image.kind === "rendering" &&
      image.status === "complete" &&
      image.url &&
      (image.rendering_source == null || image.rendering_source === "external"),
  );
}

export function renderingDownloadEntries(
  projectName: string,
  rooms: DownloadRoom[],
  images: RoomImage[],
  selected: Set<string>,
) {
  const counters = new Map<string, number>();
  return [...rooms]
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .flatMap((room) =>
      externalRenderingCandidates(images, [room])
        .filter((image) => selected.has(image.id))
        .sort(
          (a, b) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            (a.created_at || "").localeCompare(b.created_at || "") ||
            a.id.localeCompare(b.id),
        )
        .map((image) => {
          const stem = `${safeRenderingFilename(projectName, "Project")} ${safeRenderingFilename(room.name, "Room")}`;
          const key = stem.toLocaleLowerCase("en-US");
          const number = (counters.get(key) ?? 0) + 1;
          counters.set(key, number);
          return { image, roomName: room.name, filenameStem: `${stem} ${number}` };
        }),
    );
}

function renderingImageExtension(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "png";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "gif";
  throw new Error("The saved file is not a supported image.");
}

export async function buildExternalRenderingZip(
  projectName: string,
  entries: RenderingDownloadEntry[],
  onProgress: (done: number) => void,
  fetcher: typeof fetch = fetch,
) {
  if (!entries.length) throw new Error("Select at least one external rendering.");
  const files: Record<string, Uint8Array> = {};
  const controller = new AbortController();
  let index = 0,
    done = 0;
  const worker = async () => {
    while (index < entries.length && !controller.signal.aborted) {
      const entry = entries[index++];
      try {
        const response = await fetcher(entry.image.url, { signal: controller.signal });
        if (!response.ok) throw new Error("The saved image could not be downloaded.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const extension = renderingImageExtension(bytes);
        files[`${entry.filenameStem}.${extension}`] = bytes;
        onProgress(++done);
      } catch {
        controller.abort();
        throw new Error(
          `Could not download ${entry.filenameStem}. No ZIP was downloaded. Check this image or deselect it and try again.`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker));
  const { zipSync } = await import("fflate");
  const zip = zipSync(files, { level: 0 });
  return {
    blob: new Blob([new Uint8Array(zip).buffer], { type: "application/zip" }),
    filename: `${safeRenderingFilename(projectName, "Project")} External Renderings.zip`,
  };
}
