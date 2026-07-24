import type { MaterialItem, Product, Project, Room } from "@/lib/db";

export const MERAV_CART_PLUGIN_ID = "merav-cart-builder";
export const PROCUREMENT_RUN_TTL_MINUTES = 60;

export const PROCUREMENT_ITEM_STATUSES = [
  "prepared",
  "queued",
  "opening_product",
  "selecting_options",
  "added",
  "needs_review",
  "option_mismatch",
  "out_of_stock",
  "backordered",
  "price_changed",
  "login_required",
  "captcha_required",
  "unsupported_retailer",
  "failed",
  "skipped",
  "completed",
] as const;

export type ProcurementItemStatus = (typeof PROCUREMENT_ITEM_STATUSES)[number];
export type ProcurementRunStatus =
  | "prepared"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "expired";
export type ProcurementPreflightStatus =
  | "ready"
  | "missing_product_link"
  | "missing_quantity"
  | "missing_required_option"
  | "invalid_link"
  | "needs_review"
  | "excluded";
export type ProcurementOptionKey = "color" | "finish" | "size" | "dimensions";

export interface ProcurementDraft {
  specBookItemId: string;
  projectId: string;
  projectName: string;
  roomId: string;
  roomName: string;
  productId: string;
  productName: string;
  vendor: string;
  productUrl: string;
  sku: string;
  quantity: number | null;
  color: string;
  finish: string;
  size: string;
  dimensions: string;
  otherRequirements: string;
  expectedPrice: number | null;
  imageUrl: string;
  notes: string;
  substitutionInstructions: string;
  requiredOptionKeys: ProcurementOptionKey[];
  selected: boolean;
  sourceExcluded: boolean;
  sourceNeedsReview: boolean;
}

export interface ProcurementSnapshot {
  spec_book_item_id: string;
  product_id: string;
  room_id: string;
  room_name: string;
  product_name: string;
  vendor: string | null;
  retailer_domain: string;
  product_url: string;
  sku: string | null;
  requested_quantity: number;
  requested_options: {
    color: string | null;
    finish: string | null;
    size: string | null;
    dimensions: string | null;
    other_requirements: string | null;
    substitution_instructions: string | null;
  };
  expected_price: number | null;
  product_image_url: string | null;
  source_notes: string | null;
}

export interface ProcurementRunItemResult extends ProcurementSnapshot {
  id: string;
  run_id: string;
  status: ProcurementItemStatus;
  observed_product_title: string | null;
  observed_options: Record<string, unknown>;
  observed_price: number | null;
  observed_availability: string | null;
  result_notes: string | null;
  retailer_cart_url: string | null;
  retry_count: number;
  updated_at: string;
}

export interface ProcurementRunResult {
  id: string;
  project_id: string;
  project_name: string;
  created_by: string;
  status: ProcurementRunStatus;
  source_run_id: string | null;
  created_at: string;
  started_at: string | null;
  expires_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  items: ProcurementRunItemResult[];
}

export interface OptionMatchResult {
  status: "exact" | "ambiguous" | "mismatch";
  match: string | null;
}

const PLACEHOLDER_OPTION = /^(?:tbd|unknown|unsure|select|choose|pending|n\/a\?)$/i;
const CHECKOUT_ACTION =
  /\b(?:buy\s*now|begin\s*checkout|proceed\s*to\s*checkout|checkout|submit\s*order|place\s*order|payment)\b/i;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = text(value).replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeRetailerUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") || /\s/.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function classifyProcurementDraft(draft: ProcurementDraft): ProcurementPreflightStatus {
  if (!draft.selected || draft.sourceExcluded) return "excluded";
  if (!text(draft.productUrl)) return "missing_product_link";
  if (!safeRetailerUrl(draft.productUrl)) return "invalid_link";
  if (!draft.quantity || draft.quantity <= 0 || !Number.isFinite(draft.quantity)) {
    return "missing_quantity";
  }
  const missingRequired = draft.requiredOptionKeys.some((key) => {
    const value = text(draft[key]);
    return !value || PLACEHOLDER_OPTION.test(value);
  });
  if (missingRequired) return "missing_required_option";
  if (draft.sourceNeedsReview) return "needs_review";
  return "ready";
}

export function preflightLabel(status: ProcurementPreflightStatus) {
  return {
    ready: "Ready",
    missing_product_link: "Missing product link",
    missing_quantity: "Missing quantity",
    missing_required_option: "Missing required option",
    invalid_link: "Invalid link",
    needs_review: "Needs review",
    excluded: "Excluded",
  }[status];
}

export function itemStatusLabel(status: ProcurementItemStatus) {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildProcurementDraft(
  item: MaterialItem,
  project: Pick<Project, "id" | "name">,
  room: Pick<Room, "id" | "name"> | undefined,
  selected = false,
): ProcurementDraft {
  const product = item.product as Product | null | undefined;
  const productUrl = text(item.product_url) || text(product?.product_url);
  const requiredOptionKeys: ProcurementOptionKey[] = [];
  if (text(item.color)) requiredOptionKeys.push("color");
  if (text(product?.finish)) requiredOptionKeys.push("finish");
  if (text(product?.dimensions)) requiredOptionKeys.push("dimensions");

  return {
    specBookItemId: item.id,
    projectId: project.id,
    projectName: project.name,
    roomId: item.room_id,
    roomName: room?.name ?? "Unassigned",
    productId: item.product_id ?? "",
    productName: text(product?.name) || text(item.client_product_name) || text(item.item_label),
    vendor: text(product?.vendor),
    productUrl,
    sku: text(product?.sku),
    quantity: item.quantity,
    color: text(item.color),
    finish: text(product?.finish),
    size: "",
    dimensions: text(product?.dimensions),
    otherRequirements: "",
    expectedPrice: parseMoney(product?.price),
    imageUrl: text(item.image_url) || text(product?.image_url),
    notes: text(item.notes) || text(product?.notes),
    substitutionInstructions: "",
    requiredOptionKeys,
    selected,
    sourceExcluded: item.not_needed || !item.product_id || !product,
    sourceNeedsReview:
      item.ordered === true ||
      item.room_product?.approval_status === "declined" ||
      item.finish_check_status === "possible_mismatch" ||
      item.finish_check_status === "uncertain",
  };
}

export function snapshotProcurementDraft(draft: ProcurementDraft): ProcurementSnapshot {
  if (classifyProcurementDraft(draft) !== "ready") {
    throw new Error("Only Ready products can be frozen into a procurement run.");
  }
  const url = safeRetailerUrl(draft.productUrl);
  if (!url || !draft.quantity) throw new Error("Ready product is missing its URL or quantity.");

  return {
    spec_book_item_id: draft.specBookItemId,
    product_id: draft.productId,
    room_id: draft.roomId,
    room_name: draft.roomName,
    product_name: draft.productName,
    vendor: draft.vendor || null,
    retailer_domain: url.hostname.toLowerCase().replace(/^www\./, ""),
    product_url: url.toString(),
    sku: draft.sku || null,
    requested_quantity: draft.quantity,
    requested_options: {
      color: draft.color || null,
      finish: draft.finish || null,
      size: draft.size || null,
      dimensions: draft.dimensions || null,
      other_requirements: draft.otherRequirements || null,
      substitution_instructions: draft.substitutionInstructions || null,
    },
    expected_price: draft.expectedPrice,
    product_image_url: draft.imageUrl || null,
    source_notes: draft.notes || null,
  };
}

export function buildRunSnapshots(drafts: ProcurementDraft[]) {
  if (!drafts.length) throw new Error("Select at least one Ready product.");
  const ids = drafts.map((draft) => draft.specBookItemId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("A Spec Book product can appear only once in a cart run.");
  }
  return drafts.map(snapshotProcurementDraft);
}

export function runItemBelongsToAuthorizedRun(runId: string, itemRunId: string) {
  return Boolean(runId) && runId === itemRunId;
}

export function normalizeOptionValue(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/\b(inches|inch|in\.?)\b|"/g, " in ")
    .replace(/\s*(?:×|\bby\b)\s*/g, " x ")
    .replace(/[-–—]/g, " ")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchRequestedOption(requested: string, candidates: string[]): OptionMatchResult {
  const normalizedRequested = normalizeOptionValue(requested);
  const matches = candidates.filter(
    (candidate) => normalizeOptionValue(candidate) === normalizedRequested,
  );
  if (matches.length === 1) return { status: "exact", match: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", match: null };
  return { status: "mismatch", match: null };
}

export function hasPriceChanged(expected: number | null, observed: number | null) {
  if (expected === null || observed === null) return false;
  return Math.abs(expected - observed) >= 0.01;
}

export function isCheckoutOrPaymentAction(action: string) {
  return CHECKOUT_ACTION.test(action);
}

export function isRetryableStatus(status: ProcurementItemStatus) {
  return !["added", "completed", "skipped"].includes(status);
}

export function buildProcurementPrompt(input: { runId: string; runAuthorization: string }) {
  return [
    `Use ${MERAV_CART_PLUGIN_ID} to retrieve procurement run ${input.runId}.`,
    `Run authorization: ${input.runAuthorization}`,
    "Use @Chrome to add every Ready item to its retailer cart using the exact link, quantity, color, finish, size, dimensions, and other requirements supplied by Studio.",
    "Do not guess ambiguous selections, accept substitutions unless explicitly authorized, begin checkout, enter payment information, or place an order.",
    "Update Studio after every item and finish with an exception summary.",
  ].join(" ");
}

export function buildCodexDeepLink(prompt: string) {
  return `codex://new?prompt=${encodeURIComponent(prompt)}`;
}

export function summarizeRun(items: Array<Pick<ProcurementRunItemResult, "status">>) {
  const counts = {
    added: 0,
    needs_review: 0,
    failed: 0,
    skipped: 0,
    remaining: 0,
  };
  for (const item of items) {
    if (item.status === "added" || item.status === "completed") counts.added += 1;
    else if (
      [
        "needs_review",
        "option_mismatch",
        "price_changed",
        "login_required",
        "captcha_required",
      ].includes(item.status)
    ) {
      counts.needs_review += 1;
    } else if (
      ["failed", "out_of_stock", "backordered", "unsupported_retailer"].includes(item.status)
    ) {
      counts.failed += 1;
    } else if (item.status === "skipped") counts.skipped += 1;
    else counts.remaining += 1;
  }
  return counts;
}
