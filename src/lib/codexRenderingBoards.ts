// Only visual/reference data travels with a rendering handoff. Board editing,
// comments, history and Materials sync state are never changed or exported.
export type CodexBoardPage = {
  id: string;
  title: string;
  roomId: string | null;
  pageNumber: number;
  elements: Array<Record<string, string | number | boolean | null>>;
};
const visualFields = [
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "zIndex",
  "src",
  "label",
  "productName",
  "text",
  "notes",
  "link",
  "productId",
  "materialRoomId",
  "finish",
  "materialFinish",
  "materialDimensions",
  "materialCategory",
  "hideDetails",
  "background",
  "color",
  "fontSize",
  "fontFamily",
  "letterSpacing",
  "flipHorizontal",
  "flipVertical",
  "imageCropZoom",
  "imageCropX",
  "imageCropY",
  "imageBrightness",
  "imageContrast",
  "imageSaturation",
  "imageWarmth",
] as const;
const normalized = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function codexBoardPages(
  state: unknown,
  roomIds: string[],
  rooms: Array<{ id: string; name: string }>,
): CodexBoardPage[] {
  const pages = (state as { pages?: unknown[] } | null)?.pages;
  if (!Array.isArray(pages)) return [];
  if (pages.length > 500) throw Error("Design board exceeds the batch page limit.");
  return pages.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const p = raw as Record<string, any>;
    if (p.hidden === true || p.roomApprovalStatus === "declined" || typeof p.id !== "string")
      return [];
    const title = typeof p.title === "string" ? p.title : "Untitled board";
    // An explicit room assignment wins over its title; never borrow another room's board.
    const roomId =
      p.roomId || rooms.find((r) => normalized(r.name) === normalized(title))?.id || null;
    if (!roomIds.includes(roomId) && normalized(title) !== "materialsthroughout") return [];
    const elements = (Array.isArray(p.elements) ? p.elements : []).filter(
      (e: any) => e && e.visible !== false && ["image", "text", "shape"].includes(e.type),
    );
    if (elements.length > 1000) throw Error("Design board exceeds the batch item limit.");
    return [
      {
        id: p.id,
        title,
        roomId,
        pageNumber: Number.isInteger(p.pageNumber) ? p.pageNumber : index + 1,
        // Include pattern/inspiration images even when excluded from Materials.
        elements: elements.map((e: any) =>
          Object.fromEntries(
            visualFields.flatMap((key) => {
              const value = e[key];
              return value === null ||
                typeof value === "boolean" ||
                (typeof value === "number" && Number.isFinite(value)) ||
                typeof value === "string"
                ? [[key, value]]
                : [];
            }),
          ),
        ),
      },
    ];
  });
}
const escapeXml = (value: unknown) =>
  String(value ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
// Portable vector overview plus the original image files. Crop/effects remain
// explicit in JSON; this overview is not a replacement for the live board.
export function codexBoardSvg(page: CodexBoardPage, imageFiles: Record<string, string>) {
  const shapes = [...page.elements]
    .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
    .map((e) => {
      const x = Number(e.x) || 0,
        y = Number(e.y) || 0;
      const w = Math.max(1, Number(e.width) || 1),
        h = Math.max(1, Number(e.height) || 1);
      const rotation = Number(e.rotation) || 0;
      let content = "";
      if (e.type === "image") {
        const file = imageFiles[String(e.id)];
        content = file
          ? `<image href="../${escapeXml(file)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#eee" stroke="#b00"/><text x="${x}" y="${y + 16}">IMAGE UNAVAILABLE</text>`;
        if (!e.hideDetails)
          content += `<text x="${x + w / 2}" y="${y + h + 14}" text-anchor="middle" font-size="11">${escapeXml(e.label || e.productName)}</text>`;
      } else if (e.type === "shape")
        content = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(e.background || "#ddd")}"/>`;
      else
        content = String(e.text || "")
          .split("\n")
          .map(
            (line, i) =>
              `<text x="${x}" y="${y + Number(e.fontSize || 16) * (i + 1)}" font-size="${Number(e.fontSize) || 16}" fill="${escapeXml(e.color || "#000")}">${escapeXml(line)}</text>`,
          )
          .join("");
      return `<g transform="rotate(${rotation} ${x + w / 2} ${y + h / 2})">${content}</g>`;
    });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900" viewBox="0 0 1400 900"><rect width="1400" height="900" fill="#fbfaf7"/>${shapes.join("")}</svg>`;
}
