export type RenderingImportRoom = {
  id: string;
  name: string;
};

export type RenderingImportPageText = {
  caption: string;
  elevationId: string | null;
};

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function renderingImportPageText(
  text: string,
  fileName: string,
  pageNumber: number,
): RenderingImportPageText {
  const lines = meaningfulLines(text);
  const elevationPattern = /\b[A-Z]{1,5}\d+(?:\.\d+)*(?:-\d+)+\b/i;
  const elevationLine = lines.find((line) => elevationPattern.test(line));
  const elevationId = (elevationLine || text).match(elevationPattern)?.[0]?.toUpperCase() ?? null;
  const firstUsefulLine =
    elevationLine ||
    lines.find((line) => line.length >= 3 && line.length <= 160) ||
    lines[0] ||
    "";
  const withoutElevation = elevationId
    ? firstUsefulLine
        .replace(new RegExp(elevationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
        .replace(/^[\s:|./-]+|[\s:|./-]+$/g, "")
        .trim()
    : firstUsefulLine;
  const fallbackName = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  const caption = (withoutElevation || firstUsefulLine || `${fallbackName} - Page ${pageNumber}`)
    .slice(0, 180)
    .trim();

  return {
    caption: caption || `Imported rendering - Page ${pageNumber}`,
    elevationId,
  };
}

export function suggestRenderingImportRoom(text: string, rooms: RenderingImportRoom[]) {
  const searchable = ` ${normalizeSearchText(text)} `;
  const matches = rooms
    .map((room) => {
      const normalizedName = normalizeSearchText(room.name);
      if (!normalizedName || !searchable.includes(` ${normalizedName} `)) return null;
      return { roomId: room.id, roomName: room.name, score: normalizedName.length };
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match))
    .sort((a, b) => b.score - a.score);

  if (!matches.length) return null;
  if (matches.length > 1 && matches[0].score === matches[1].score) return null;
  return matches[0];
}

export function renderingImportPagePath(
  projectId: string,
  fileHash: string,
  pageNumber: number,
) {
  return `rendering-imports/${projectId}/${fileHash}/page-${String(pageNumber).padStart(4, "0")}.png`;
}

export function renderingImportSlideKey(roomId: string, imageId: string) {
  return `room:${roomId}:view:${imageId}`;
}
