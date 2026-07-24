import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { MaterialItem } from "@/lib/db";
import {
  buildCodexDeepLink,
  buildProcurementDraft,
  buildProcurementPrompt,
  buildRunSnapshots,
  classifyProcurementDraft,
  hasPriceChanged,
  isCheckoutOrPaymentAction,
  isRetryableStatus,
  matchRequestedOption,
  normalizeOptionValue,
  runItemBelongsToAuthorizedRun,
  snapshotProcurementDraft,
  type ProcurementDraft,
} from "@/lib/procurementCart";
import {
  generateRunAuthorization,
  hashRunAuthorization,
  isRunAuthorizationUsable,
  runAuthorizationMatches,
} from "@/lib/procurementToken.server";

function material(overrides: Partial<MaterialItem> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    room_id: "22222222-2222-4222-8222-222222222222",
    project_id: "33333333-3333-4333-8333-333333333333",
    item_label: "Pendant",
    client_product_name: "Natural Oak Pendant",
    category: "Lighting",
    is_required: true,
    sort_order: 0,
    cad_label: null,
    product_url: null,
    quantity: 2,
    color: null,
    image_url: null,
    notes: "Use the 24-inch version.",
    not_needed: false,
    ordered_by: "Merav",
    ordered: false,
    product_id: "44444444-4444-4444-8444-444444444444",
    source_board_id: null,
    source_board_page_id: null,
    source_board_element_id: null,
    scrape_status: "complete",
    scrape_error: null,
    finish_check_status: "match",
    created_at: "2026-07-24T00:00:00.000Z",
    updated_at: "2026-07-24T00:00:00.000Z",
    product: {
      id: "44444444-4444-4444-8444-444444444444",
      category: "Lighting",
      subcategory: "Pendant",
      name: "Natural Oak Pendant",
      vendor: "Mock Retailer",
      product_url: "https://shop.example.com/products/oak-pendant",
      image_url: "https://images.example.com/oak-pendant.jpg",
      finish: "Natural Oak",
      sku: "PEND-24-OAK",
      notes: null,
      dimensions: '24"',
      price: "$249.00",
      unit_cost: null,
      shipping: null,
      description: null,
      has_sample: false,
      created_at: "2026-07-24T00:00:00.000Z",
      updated_at: "2026-07-24T00:00:00.000Z",
    },
    room_product: {
      id: "55555555-5555-4555-8555-555555555555",
      room_id: "22222222-2222-4222-8222-222222222222",
      product_id: "44444444-4444-4444-8444-444444444444",
      is_key_selection: true,
      sort_order: 0,
      room_notes: null,
      approved: true,
      approval_status: "approved",
      approval_comment: null,
      approval_updated_at: null,
      approval_visible: true,
    },
    ...overrides,
  } as MaterialItem;
}

function readyDraft() {
  return buildProcurementDraft(
    material(),
    { id: "33333333-3333-4333-8333-333333333333", name: "Mock Residence" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Kitchen" },
    true,
  );
}

describe("Spec Book selection and preflight", () => {
  it("selects an existing Spec Book product and classifies it Ready", () => {
    const draft = readyDraft();
    expect(draft.productName).toBe("Natural Oak Pendant");
    expect(draft.quantity).toBe(2);
    expect(classifyProcurementDraft(draft)).toBe("ready");
  });

  it.each([
    [{ productUrl: "" }, "missing_product_link"],
    [{ productUrl: "javascript:alert(1)" }, "invalid_link"],
    [{ quantity: null }, "missing_quantity"],
    [{ size: "", requiredOptionKeys: ["size"] }, "missing_required_option"],
    [{ sourceNeedsReview: true }, "needs_review"],
    [{ selected: false }, "excluded"],
  ] as const)("classifies %o as %s", (patch, expected) => {
    expect(classifyProcurementDraft({ ...readyDraft(), ...patch } as ProcurementDraft)).toBe(
      expected,
    );
  });
});

describe("Frozen snapshots and duplicate prevention", () => {
  it("freezes exact product requirements independently of later draft edits", () => {
    const draft = { ...readyDraft(), color: "Sand", size: "24 in" };
    const snapshot = snapshotProcurementDraft(draft);
    draft.color = "Black";
    draft.quantity = 9;
    expect(snapshot.requested_options.color).toBe("Sand");
    expect(snapshot.requested_quantity).toBe(2);
    expect(snapshot.retailer_domain).toBe("shop.example.com");
  });

  it("builds a run snapshot and rejects duplicate Spec Book item IDs", () => {
    const draft = readyDraft();
    expect(buildRunSnapshots([draft])).toHaveLength(1);
    expect(() => buildRunSnapshots([draft, { ...draft }])).toThrow(/only once/i);
  });
});

describe("Run authorization", () => {
  it("uses 256-bit random tokens and stores only a stable SHA-256 hash", () => {
    const token = generateRunAuthorization();
    const other = generateRunAuthorization();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).not.toBe(other);
    expect(hashRunAuthorization(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(runAuthorizationMatches(token, hashRunAuthorization(token))).toBe(true);
    expect(runAuthorizationMatches(other, hashRunAuthorization(token))).toBe(false);
  });

  it("enforces expiry, revocation, and run-item scoping", () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    expect(
      isRunAuthorizationUsable({
        expiresAt: "2026-07-24T12:59:00.000Z",
        now,
      }),
    ).toBe(true);
    expect(
      isRunAuthorizationUsable({
        expiresAt: "2026-07-24T11:59:00.000Z",
        now,
      }),
    ).toBe(false);
    expect(
      isRunAuthorizationUsable({
        expiresAt: "2026-07-24T12:59:00.000Z",
        revokedAt: "2026-07-24T12:01:00.000Z",
        now,
      }),
    ).toBe(false);
    expect(runItemBelongsToAuthorizedRun("run-a", "run-a")).toBe(true);
    expect(runItemBelongsToAuthorizedRun("run-a", "run-b")).toBe(false);
  });
});

describe("Prompt, matching, retry, and safety contract", () => {
  it("generates an encoded Codex deep link with the real plugin ID and @Chrome", () => {
    const prompt = buildProcurementPrompt({
      runId: "run-123",
      runAuthorization: "secret-token",
    });
    expect(prompt).toContain("merav-cart-builder");
    expect(prompt).toContain("@Chrome");
    expect(prompt).toContain("Do not guess");
    expect(decodeURIComponent(buildCodexDeepLink(prompt).split("prompt=")[1])).toBe(prompt);
  });

  it("normalizes harmless formatting but stops on ambiguous options", () => {
    expect(normalizeOptionValue('24" x 36-inch')).toBe(normalizeOptionValue("24 in by 36 in"));
    expect(matchRequestedOption("Natural Oak", ["natural oak"]).status).toBe("exact");
    expect(matchRequestedOption("Natural Oak", ["Natural-Oak", "Natural Oak"]).status).toBe(
      "ambiguous",
    );
    expect(matchRequestedOption("Natural Oak", ["White Oak"]).status).toBe("mismatch");
  });

  it("records price changes and retries only unresolved statuses", () => {
    expect(hasPriceChanged(249, 259)).toBe(true);
    expect(hasPriceChanged(249, 249)).toBe(false);
    expect(isRetryableStatus("out_of_stock")).toBe(true);
    expect(isRetryableStatus("failed")).toBe(true);
    expect(isRetryableStatus("added")).toBe(false);
    expect(isRetryableStatus("completed")).toBe(false);
  });

  it("blocks checkout, order submission, and payment actions", () => {
    expect(isCheckoutOrPaymentAction("Proceed to checkout")).toBe(true);
    expect(isCheckoutOrPaymentAction("Place Order")).toBe(true);
    expect(isCheckoutOrPaymentAction("Select payment method")).toBe(true);
    expect(isCheckoutOrPaymentAction("Add to cart")).toBe(false);
  });

  it("uses safe mock retailer fixtures without live accounts", async () => {
    const available = await readFile(
      new URL("./fixtures/mock-retailer.html", import.meta.url),
      "utf8",
    );
    const unavailable = await readFile(
      new URL("./fixtures/mock-retailer-out-of-stock.html", import.meta.url),
      "utf8",
    );
    expect(available).toContain("PEND-24-OAK");
    expect(available).toContain("Add to cart");
    expect(available).not.toMatch(/checkout|place order|payment/i);
    expect(unavailable).toContain('data-stock="out-of-stock"');
    expect(unavailable).toContain("disabled");
  });
});
