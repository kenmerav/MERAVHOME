export type BoardOption = { label: string; image: string; attributes?: Record<string, string>; sku?: string; variantId?: string };
export type BoardOptionMatch = {
  status: "matched" | "uncertain" | "unavailable";
  option: string;
  reason: string;
  options: BoardOption[];
  boardImage: string;
  productUrl: string;
  optionKind: "color" | "finish" | "size" | "variant";
  attributes?: Record<string, string>;
  sku?: string;
  variantId?: string;
  warnings?: import("./boardProductWarnings").BoardProductWarning[];
  linkedVariant?: LinkedProductVariant;
};

export type LinkedProductVariant = { sourceUrl: string; variantId: string; attributes: Record<string, string>; sku?: string };

// An unavailable image comparison can still carry useful verified evidence.
// A cache miss has no such evidence and should be retried normally.
export function reusableBoardOptionMatch(result: BoardOptionMatch): boolean {
  return result.status === "matched" || result.status === "uncertain" ||
    !!result.linkedVariant || !!result.warnings?.length;
}

// Link evidence is not visual evidence: require the exact URL-selected ID and
// retailer-published attributes for this same product before presenting it.
export function linkedProductVariant(value: unknown, sourceUrl: string): LinkedProductVariant | null {
  const product = value && typeof value === "object" ? value as Record<string, any> : {};
  try {
    const expected = new URL(sourceUrl), actual = new URL(product.url);
    if (expected.hostname.toLowerCase() !== actual.hostname.toLowerCase() || expected.pathname.replace(/\/$/, "") !== actual.pathname.replace(/\/$/, "")) return null;
    const identifiers = [...expected.searchParams.entries()].filter(([key]) => /^(variant|sku|uid|itemno|pid|piid)$/i.test(key)).map(([, value]) => value.trim());
    const path = expected.pathname.split("/").filter(Boolean).pop() || "";
    if (/^s\d+$/i.test(path)) identifiers.push(path.slice(1));
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const selected = variants.filter((v: any) => [v?.id, v?.sku].some(id => (typeof id === "string" || typeof id === "number") && identifiers.includes(String(id))));
    if (selected.length !== 1) return null;
    const row = selected[0], values = row.values && typeof row.values === "object" ? row.values : {};
    const attributes = Object.fromEntries(Object.entries(values).filter(([key, val]) => /^(?:colou?r|finish|size|dimensions?|centers?)$/i.test(key) && typeof val === "string" && !!val.trim() && !/\b(?:or|unknown|tbd|choose|select)\b/i.test(val)).map(([key, val]) => [key.toLowerCase().replace("colour", "color"), (val as string).trim().slice(0, 150)]));
    if (!Object.keys(attributes).length) return null;
    return { sourceUrl, variantId: String(row.id || row.sku), attributes, ...(typeof row.sku === "string" && row.sku.trim() ? { sku: row.sku.trim() } : {}) };
  } catch { return null; }
}

// Only compare explicitly labelled retailer option images. Duplicate pictures,
// omitted images, or a truncated set cannot establish an exact choice.
export function prepareBoardOptions(images: Record<string, string>, advertised: string[]): BoardOption[] {
  const labels = [...new Set(advertised.map(x => x.trim()).filter(Boolean))];
  if (labels.length < 2 || labels.length > 10) return [];
  const options = labels.map(label => ({ label, image: images[label]?.trim() || "" }));
  if (options.some(option => !option.image) || new Set(options.map(option => option.image)).size !== options.length) return [];
  return options;
}

// Some retailers publish finish or size buttons with their own product photos.
// Keep each option group separate: a color photo does not select a size.
export function publishedImageOptions(html: string): { kind: "color" | "finish" | "size"; options: BoardOption[] } | null {
  const groups: Record<"color" | "finish" | "size", BoardOption[]> = { color: [], finish: [], size: [] };
  const attr = (tag: string, key: string) => new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1]?.replace(/&amp;/g, "&") || "";
  for (const match of html.matchAll(/<(?:span|button)\b([^>]*data-parent-id=[^>]*)>([\s\S]*?)<\/(?:span|button)>/gi)) {
    const kind = attr(match[1], "data-parent-id");
    const group = /colou?r|colorway/i.test(kind) ? "color" : /finish/i.test(kind) ? "finish" : /size|dimension/i.test(kind) ? "size" : null;
    const label = attr(match[1], "data-text") || attr(match[1], "aria-label");
    const image = attr(/<img\b[^>]*>/i.exec(match[2])?.[0] || "", "src");
    if (group && label) groups[group].push({ label, image });
  }
  for (const kind of ["color", "finish", "size"] as const) {
    const raw = groups[kind];
    if (raw.some(option => raw.some(other => other.label === option.label && other.image !== option.image))) continue;
    const options = prepareBoardOptions(Object.fromEntries(raw.map(option => [option.label, option.image])), raw.map(option => option.label));
    if (options.length) return { kind, options };
  }
  return null;
}

// Firecrawl's product result may supply per-variant images even when the
// swatches are rendered by JavaScript. Require every published variant to
// participate and never combine independent size and finish options.
export function structuredImageOptions(value: unknown, sourceUrl: string): { kind: "color" | "finish" | "size" | "variant"; options: BoardOption[] } | null {
  const product = value && typeof value === "object" ? value as Record<string, any> : {};
  try {
    const expected = new URL(sourceUrl), actual = new URL(product.url);
    if (expected.hostname.toLowerCase() !== actual.hostname.toLowerCase() ||
        expected.pathname.replace(/\/$/, "") !== actual.pathname.replace(/\/$/, "")) return null;
  } catch { return null; }
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length < 2 || variants.length > 100) return null;
  for (const kind of ["color", "finish", "size"] as const) {
    const pattern = kind === "color" ? /colou?r|colorway/i : kind === "finish" ? /finish/i : /size|dimension/i;
    const options: BoardOption[] = [];
    for (const variant of variants) {
      const values = variant?.values && typeof variant.values === "object" ? variant.values : {};
      const entries = Object.entries(values).filter(([key]) => pattern.test(key));
      const label = entries.length === 1 && typeof entries[0][1] === "string" ? (entries[0][1] as string).trim() : "";
      const image = Array.isArray(variant?.images) && typeof variant.images[0]?.url === "string" ? variant.images[0].url.trim() : "";
      if (!label || !image) { options.length = 0; break; }
      if (options.some(option => option.label === label && option.image !== image)) { options.length = 0; break; }
      if (!options.some(option => option.label === label)) options.push({ label, image });
    }
    const validated = prepareBoardOptions(Object.fromEntries(options.map(option => [option.label, option.image])), options.map(option => option.label));
    if (validated.length) return { kind, options: validated };
  }
  const combined: BoardOption[] = [];
  for (const variant of variants) {
    const values = variant?.values && typeof variant.values === "object" ? variant.values : {};
    const attributes = Object.fromEntries(Object.entries(values).filter(([key, value]) => /colou?r|finish|size/i.test(key) && typeof value === "string" && !!value.trim()).map(([key, value]) => [key.toLowerCase().replace("colour", "color"), (value as string).trim()]));
    const label = Object.values(attributes).join(" / ");
    const image = Array.isArray(variant?.images) && typeof variant.images[0]?.url === "string" ? variant.images[0].url.trim() : "";
    if (!label || !image || combined.some(option => option.label === label)) return null;
    combined.push({ label, image, attributes,
      ...(typeof variant.sku === "string" && variant.sku.trim() ? { sku: variant.sku.trim() } : {}),
      ...(typeof variant.id === "string" && variant.id.trim() ? { variantId: variant.id.trim() } : {}) });
  }
  const validated = prepareBoardOptions(Object.fromEntries(combined.map(option => [option.label, option.image])), combined.map(option => option.label));
  if (validated.length) return { kind: "variant", options: combined };
  return null;
}

export function cleanBoardOptionMatch(value: unknown, options: BoardOption[], boardImage: string, productUrl: string, optionKind: BoardOptionMatch["optionKind"] = "color"): BoardOptionMatch {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const index = row.option_index;
  const reason = typeof row.reason === "string" ? row.reason.trim().slice(0, 500) : "";
  const confident = row.status === "matched" && Number.isInteger(index) &&
    typeof index === "number" && index >= 0 && index < options.length &&
    typeof row.confidence === "number" && row.confidence >= 0.9 && row.confidence <= 1 && !!reason;
  return { status: confident ? "matched" : "uncertain", option: confident ? options[index].label : "",
    reason: reason || "The images do not establish a single option. Review the retailer selection.", options, boardImage, productUrl, optionKind,
    ...(confident && options[index].attributes ? { attributes: options[index].attributes } : {}),
    ...(confident && options[index].sku ? { sku: options[index].sku } : {}),
    ...(confident && options[index].variantId ? { variantId: options[index].variantId } : {}) };
}

export type BoardOptionBatchItem = { id: string; item_label?: string | null; product_url?: string | null; image_url?: string | null;
  source_board_element_id?: string | null; product?: { product_url?: string | null } | null };
export function boardOptionBatchCandidates<T extends BoardOptionBatchItem>(items: T[]): T[] {
  return items.filter(item => !!(item.product_url || item.product?.product_url) && !!(item.source_board_element_id || item.image_url));
}

// Run one at a time, keep partial results, and never repeat paid calls automatically.
export async function runBoardOptionBatch<T extends BoardOptionBatchItem>(items: T[],
  match: (item: T) => Promise<BoardOptionMatch>,
  onResult: (item: T, result: BoardOptionMatch | null, error: string) => void,
  shouldStop: () => boolean) {
  let attempted = 0;
  for (const item of items) {
    if (shouldStop()) break;
    try { onResult(item, await match(item), ""); }
    catch (error) { onResult(item, null, error instanceof Error ? error.message : "The comparison failed."); }
    attempted++;
  }
  return { attempted, stopped: attempted < items.length };
}
