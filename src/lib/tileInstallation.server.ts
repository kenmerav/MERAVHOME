import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { projectDocumentStoragePath } from "./constructionDocumentPath.server";
import { reviewTileInstallation, needsTileInstallation } from "./tileInstallation";
import type { MaterialItem } from "./db";
import type { DrawingMatchDocument } from "./specDrawingMatches";

const admin = supabaseAdmin as any;
// Cache PDF text only, never final decisions: editing notes always recomputes
// the review. Versioned document identity prevents using a previous drawing set.
const texts = new Map<string, Promise<{ page: number; text: string }[]>>();
async function pages(projectId: string, doc: DrawingMatchDocument) {
  const key = createHash("sha256").update(JSON.stringify([projectId, doc])).digest("hex");
  const existing = texts.get(key); if (existing) return existing;
  const pending = (async () => {
    const path = projectDocumentStoragePath(doc.file_url, projectId, process.env.SUPABASE_URL || "");
    const { data: file, error } = await admin.storage.from("project-files").download(path);
    if (error || !file || file.size > 50 * 1024 * 1024) throw Error("Could not read current construction PDF.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const count = (await PDFDocument.load(bytes)).getPageCount();
    if (count > 150) throw Error("Construction PDF needs manual review.");
    const { extractDrawingPageText } = await import("./specDrawingText.server");
    return extractDrawingPageText(bytes, count);
  })();
  texts.set(key, pending);
  while (texts.size > 3) texts.delete(texts.keys().next().value!);
  try { return await pending; } catch (error) { texts.delete(key); throw error; }
}

// Called after the existing staff/project authorization. It reads only the
// authorized project's current PDF. No extra AI requests or production writes.
export async function checkTileInstallation(projectId: string, items: MaterialItem[], rooms: { id: string; name: string }[], board: unknown,
  document: DrawingMatchDocument | null, allowPlans = true) {
  let textPages: { page: number; text: string }[] = [];
  let status: "checked" | "no_document" | "unavailable" = document ? "checked" : "no_document";
  if (document && items.some(needsTileInstallation)) {
    try {
      if (!allowPlans) throw Error("Latest document could not be confirmed.");
      textPages = await pages(projectId, document);
      if (textPages.some(p => p.text.trim().length < 30)) status = "unavailable";
    } catch { status = "unavailable"; }
  }
  return reviewTileInstallation(items, rooms, { board, document: document && { id: document.id, title: document.title, updated_at: document.updated_at },
    planStatus: status, pages: textPages });
}
