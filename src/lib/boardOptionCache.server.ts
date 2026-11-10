import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BoardOptionMatch } from "./boardOptionMatch";

const admin = supabaseAdmin as any;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function boardOptionSignature(item: any, source: unknown) {
  return createHash("sha256").update(JSON.stringify([item.id, item.room_id, item.product_id, item.product_url,
    item.product?.product_url, item.product?.sku, item.color, item.product?.finish, source])).digest("hex");
}
export async function readBoardOptionCache(projectId: string, itemId: string, signature: string): Promise<BoardOptionMatch | null> {
  const { data, error } = await admin.from("spec_completion_reviews").select("report").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  const entry = data?.report?.board_option_matches?.[itemId];
  return entry?.signature === signature && Date.now() - Date.parse(entry.checkedAt) < MAX_AGE ? entry.value : null;
}
export async function saveBoardOptionCache(projectId: string, itemId: string, signature: string, value: BoardOptionMatch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await admin.from("spec_completion_reviews").select("report,updated_at").eq("project_id", projectId).maybeSingle();
    if (error || !data) return false;
    const existing = Object.entries(data.report?.board_option_matches || {}).filter(([id]) => id !== itemId)
      .sort((a: any, b: any) => String(b[1]?.checkedAt || "").localeCompare(String(a[1]?.checkedAt || ""))).slice(0, 299);
    const report = { ...data.report, board_option_matches: { ...Object.fromEntries(existing), [itemId]: { signature, checkedAt: new Date().toISOString(), value } } };
    const result = await admin.from("spec_completion_reviews").update({ report, updated_at: new Date(Math.max(Date.now(), Date.parse(data.updated_at) + 1)).toISOString() })
      .eq("project_id", projectId).eq("updated_at", data.updated_at).select("project_id").maybeSingle();
    if (result.error) return false;
    if (result.data) return true;
  }
  return false;
}
