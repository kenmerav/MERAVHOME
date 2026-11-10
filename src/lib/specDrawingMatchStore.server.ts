import { createHash } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ProjectAccessError } from "./measuredAccess.server";
import { projectDocumentStoragePath } from "./constructionDocumentPath.server";
import { staleSpecBookMaterialIds } from "./specBookSources";
import {
  drawingMatchItems,
  drawingMatchSignature,
  type DrawingMatchDocument,
} from "./specDrawingMatches";
import type { DrawingMatchStore } from "./specDrawingMatchEngine.server";

const admin = supabaseAdmin as any;
const BUCKET = "rendering-studio-files";
export function quantityDrawingKey(sourceKey: string, attempt = 0) {
  return createHash("sha256").update(`quantity-review-v2:${sourceKey}:${attempt}`).digest("hex");
}
async function rows(table: string, select: string, projectId: string) {
  const all: any[] = [];
  for (let offset = 0; offset < 3000; offset += 1000) {
    const result = await admin
      .from(table)
      .select(select)
      .eq("project_id", projectId)
      .order("id")
      .range(offset, offset + 999);
    if (result.error) throw result.error;
    all.push(...result.data);
    if (result.data.length < 1000) return all;
  }
  throw new ProjectAccessError("This project exceeds the drawing scan selection limit.", 413);
}
export async function currentDrawingMatchSource(projectId: string, purpose?: "quantities") {
  z.string().uuid().parse(projectId);
  const [materials, rooms, board, docs] = await Promise.all([
    rows("material_items", "*,product:products(*)", projectId),
    rows("rooms", "id,name", projectId),
    admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle(),
    admin
      .from("project_documents")
      .select("id,title,file_url,file_size,updated_at")
      .eq("project_id", projectId)
      .eq("document_type", "Construction Doc")
      .is("superseded_by_document_id", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
  ]);
  if (board.error || docs.error) throw board.error || docs.error;
  const document: DrawingMatchDocument | null = docs.data?.[0] || null;
  const stale = new Set(staleSpecBookMaterialIds(projectId, materials, board.data?.board_state));
  const items = drawingMatchItems(
    materials.filter((item) => !stale.has(item.id)),
    rooms,
    purpose === "quantities",
  );
  const key = document
    ? createHash("sha256")
        .update(drawingMatchSignature(projectId, document, items))
        .digest("hex")
    : "";
  // Old quantity jobs lack the identity/version snapshot needed for approval.
  // Keep them available as read-only evidence without rerunning an AI scan.
  const legacyItems = items.map(({ quantityUnit, productId, materialUpdatedAt, productUpdatedAt, ...item }) => item);
  const legacyKey = purpose === "quantities" && document
    ? createHash("sha256").update(drawingMatchSignature(projectId, document, legacyItems)).digest("hex") : "";
  return { document, items, key, legacyKey };
}
export function productionDrawingMatchStore(projectId: string): DrawingMatchStore {
  z.string().uuid().parse(projectId);
  const asset = (path: string) => {
    if (
      !/^[a-f0-9]{64}\/(job\.json|chunk-\d{1,2}(?:-(?:request|result))?\.(?:json|pdf))$/.test(path)
    )
      throw Error("Invalid drawing scan asset.");
    return `${projectId}/spec-drawing-matches/${path}`;
  };
  const store = () => admin.storage.from(BUCKET);
  return {
    async read<T>(path: string): Promise<T | null> {
      const { data, error } = await store().download(asset(path));
      if (error) {
        if (String(error.statusCode) === "404" || /not found|does not exist/i.test(error.message))
          return null;
        throw error;
      }
      return JSON.parse(await data.text());
    },
    async write(path, value, exclusive = false) {
      const { error } = await store().upload(asset(path), Buffer.from(JSON.stringify(value)), {
        contentType: "application/octet-stream",
        cacheControl: "0",
        upsert: !exclusive,
      });
      if (error) {
        if (
          exclusive &&
          (/already exists|duplicate/i.test(error.message) || String(error.statusCode) === "409")
        )
          return false;
        throw error;
      }
      return true;
    },
    async readBytes(path) {
      const { data, error } = await store().download(asset(path));
      if (error || !data) throw Error("Could not read the saved drawing group.");
      return new Uint8Array(await data.arrayBuffer());
    },
    async writeBytes(path, bytes) {
      const { error } = await store().upload(asset(path), bytes, {
        contentType: "application/pdf",
        cacheControl: "0",
        upsert: true,
      });
      if (error) throw error;
    },
    async sourceBytes(job) {
      const path = projectDocumentStoragePath(
        job.document.file_url,
        projectId,
        process.env.SUPABASE_URL || "",
      );
      const { data, error } = await admin.storage.from("project-files").download(path);
      if (error || !data) throw Error("Could not read the current construction PDF.");
      return new Uint8Array(await data.arrayBuffer());
    },
    async current(job) {
      const source = await currentDrawingMatchSource(projectId, job.purpose);
      return (job.purpose === "quantities" ? quantityDrawingKey(source.key, job.quantityAttempt || 0) : source.key) === job.key;
    },
  };
}
