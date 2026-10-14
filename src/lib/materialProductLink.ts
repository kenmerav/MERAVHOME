import { supabase } from "@/integrations/supabase/client";
import { refreshMaterialProductInfo } from "@/lib/materialProductRefresh";
import { updateCompletionIssue } from "@/lib/specCompletionClient";
import type { SavedCompletionIssue } from "@/lib/savedSpecCompletion";

export type MaterialLinkInput = { projectId: string; roomId: string; label: string; productUrl: string;
  existingItem?: { id: string; updated_at: string } | null; issue?: SavedCompletionIssue; onProgress?: (message: string) => void };

export async function saveAndScrapeMaterialLink(input: MaterialLinkInput) {
  let url: URL;
  try { url = new URL(input.productUrl.trim()); } catch { throw new Error("Paste a full product link starting with https:// or http://."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Paste a valid product link.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to save this product link.");
  const authorization = `Bearer ${data.session.access_token}`;
  input.onProgress?.("Saving link…");
  const response = await fetch("/api/material-catalog-suggestions", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "link", project_id: input.projectId, room_id: input.roomId, label: input.label, product_url: input.productUrl.trim(),
      existing_item_id: input.existingItem?.id ?? null, expected_updated_at: input.existingItem?.updated_at ?? null,
      ...(input.issue ? { completion_issue_key: input.issue.key, expected_issue_updated_at: input.issue.status_updated_at } : {}) }) });
  const result = await response.json();
  if (!response.ok || !result.item_id) throw new Error(result.error || "Could not save the link.");
  try {
    const summary = await refreshMaterialProductInfo(input.projectId, [result.item_id], { authorization, force: true,
      onProgress: message => input.onProgress?.(message.startsWith("Saving") ? "Saving product details…" : "Getting image, price, dimensions and color…") });
    if (summary.failed || !summary.saved) return { itemId: result.item_id, warning: "Link saved. The retailer could not be read; enter the remaining product details manually or retry Scrape Product Info." };
    if (input.issue && ["missing_item", "product", "link"].includes(input.issue.finding.field)) await updateCompletionIssue(input.projectId, input.issue, "completed");
    return { itemId: result.item_id, warning: summary.priceMissing ? "Product details saved. A reliable price was not available from the retailer." : null };
  } catch {
    return { itemId: result.item_id, warning: "Link saved. Product details or the review could not be confirmed; retry Scrape Product Info or reopen the review." };
  }
}
