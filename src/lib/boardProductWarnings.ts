export type BoardProductWarning = { message: string; sourceUrl: string; evidence: string };

// A clear manufacturer restriction is an issue for review, not an automatic
// replacement. Do not extrapolate from damp/wet ratings or infer suitability.
export function bathroomProductWarnings(page: unknown, productUrl: string, selection: { room?: string | null; client_product_name?: string | null; item_label?: string | null }): BoardProductWarning[] {
  if (!/\b(?:bathroom|bath|powder|shower)\b/i.test([selection.room, selection.client_product_name, selection.item_label].filter(Boolean).join(" "))) return [];
  const data = page && typeof page === "object" ? page as Record<string, any> : {};
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const fetched = metadata.sourceURL || metadata.sourceUrl || metadata.url;
  if (typeof fetched === "string" && fetched) {
    try {
      const expected = new URL(productUrl), actual = new URL(fetched);
      if (expected.hostname.toLowerCase() !== actual.hostname.toLowerCase() || expected.pathname.replace(/\/$/, "") !== actual.pathname.replace(/\/$/, "")) return [];
    } catch { return []; }
  }
  const content = [data.markdown, data.html, data.rawHtml].filter((x): x is string => typeof x === "string").join(" ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  const evidence = /\bnot\s+(?:suitable|recommended|approved)\s+for\s+bathroom\s+use\b/i.exec(content)?.[0];
  return evidence ? [{ message: "The product page says this fixture is not suitable for bathroom use. Verify before selecting or ordering.", sourceUrl: productUrl, evidence }] : [];
}
