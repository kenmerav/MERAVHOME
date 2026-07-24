import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { MaterialItem } from "@/lib/db";
import {
  ARIZONA_TILE_REP_EMAIL,
  KEN_PROCUREMENT_EMAIL,
  buildCodexDeepLink,
  buildProcurementDraft,
  buildProcurementEmailDrafts,
  buildProcurementPrompt,
  buildRunSnapshots,
  calculateProcurementOrderQuantity,
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
    [{ procurementMethod: "email_rep", repEmail: "" }, "missing_rep_email"],
    [{ procurementMethod: "email_rep", repEmail: "not-an-email" }, "invalid_rep_email"],
    [{ quantityUnit: "square_feet", cartonCoverageSquareFeet: null }, "missing_carton_coverage"],
    [{ quantityUnit: "boxes", quantity: 1.5 }, "invalid_tile_quantity"],
    [{ wastePercentage: 101 }, "invalid_tile_quantity"],
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
    expect(snapshot.requested_options.procurement_method).toBe("online_cart");
    expect(snapshot.requested_options.rep_email).toBeNull();
    expect(snapshot.requested_options.quantity_unit).toBe("pieces");
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
    expect(prompt).toContain("$merav-cart-workflow");
    expect(prompt).toContain("@Chrome");
    expect(prompt).not.toContain("@Gmail");
    expect(prompt).toContain(KEN_PROCUREMENT_EMAIL);
    expect(prompt).toContain("create_retailer_draft");
    expect(prompt).toContain("no Send operation");
    expect(prompt).toContain("Do not guess");
    expect(decodeURIComponent(buildCodexDeepLink(prompt).split("prompt=")[1])).toBe(prompt);
  });

  it("groups generic Email rep items into drafts with the project, products, and quantities", () => {
    const drafts = buildProcurementEmailDrafts("Desert House", [
      {
        id: "55555555-5555-4555-8555-555555555555",
        retailer_domain: "www.arizonatile.com",
        vendor: "Arizona Tile",
        product_name: "Flash White 3 x 12",
        product_url: "https://www.arizonatile.com/products/flash-white",
        sku: "FLASWHI3X12",
        room_name: "Primary Bath",
        requested_quantity: 42,
        requested_options: {
          color: "White",
          finish: "Glossy",
          size: "3 x 12",
          dimensions: null,
          other_requirements: "Confirm dye lot",
          substitution_instructions: null,
          procurement_method: "email_rep",
          rep_email: ARIZONA_TILE_REP_EMAIL,
        },
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        retailer_domain: "arizonatile.com",
        vendor: "Arizona Tile",
        product_name: "Calacatta Umber Honed",
        product_url: "https://www.arizonatile.com/products/calacatta-umber",
        sku: null,
        room_name: "Kitchen",
        requested_quantity: 3,
        requested_options: {
          color: null,
          finish: "Honed",
          size: null,
          dimensions: null,
          other_requirements: null,
          substitution_instructions: null,
          procurement_method: "email_rep",
          rep_email: ARIZONA_TILE_REP_EMAIL,
        },
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        retailer_domain: "stonesource.example.com",
        vendor: "Stone Source",
        product_name: "Limestone Field Tile",
        product_url: "https://stonesource.example.com/limestone",
        sku: "LIME-24",
        room_name: "Powder Room",
        requested_quantity: 18,
        requested_options: {
          color: "Ivory",
          finish: "Honed",
          size: "24 x 24",
          dimensions: null,
          other_requirements: null,
          substitution_instructions: null,
          procurement_method: "email_rep",
          rep_email: "alex@stonesource.example.com",
        },
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        retailer_domain: "shop.example.com",
        vendor: "Online Shop",
        product_name: "Online-only item",
        product_url: "https://shop.example.com/product",
        sku: null,
        room_name: "Kitchen",
        requested_quantity: 1,
        requested_options: {
          color: null,
          finish: null,
          size: null,
          dimensions: null,
          other_requirements: null,
          substitution_instructions: null,
          procurement_method: "online_cart",
          rep_email: null,
        },
      },
    ]);

    expect(drafts).toHaveLength(2);
    const arizonaDraft = drafts.find((draft) => draft.to === ARIZONA_TILE_REP_EMAIL);
    const stoneSourceDraft = drafts.find((draft) => draft.to === "alex@stonesource.example.com");
    expect(arizonaDraft).toMatchObject({
      retailer: "Arizona Tile",
      from_account: "ken@meravinteriors.com",
      to: ARIZONA_TILE_REP_EMAIL,
      subject: "Arizona Tile product request — Desert House",
      run_item_ids: [
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
      ],
    });
    expect(arizonaDraft?.body).toContain("Project: Desert House");
    expect(arizonaDraft?.body).toContain("Flash White 3 x 12");
    expect(arizonaDraft?.body).toContain("Quantity needed: 42 pieces");
    expect(arizonaDraft?.body).toContain("Calacatta Umber Honed");
    expect(arizonaDraft?.body).toContain("Quantity needed: 3 pieces");
    expect(arizonaDraft?.body).not.toContain("Online-only item");
    expect(stoneSourceDraft).toMatchObject({
      retailer: "Stone Source",
      from_account: KEN_PROCUREMENT_EMAIL,
      to: "alex@stonesource.example.com",
      subject: "Stone Source product request — Desert House",
    });
    expect(stoneSourceDraft?.body).toContain("Limestone Field Tile");
    expect(stoneSourceDraft?.body).toContain("Quantity needed: 18 pieces");
  });

  it("rounds square-foot tile requirements up to whole boxes with waste", () => {
    const order = calculateProcurementOrderQuantity({
      quantity: 100,
      quantityUnit: "square_feet",
      cartonCoverageSquareFeet: 12.5,
      wastePercentage: 10,
    });
    expect(order).toMatchObject({
      quantity: 9,
      unit: "boxes",
      requestedSquareFeet: 100,
      coveredSquareFeet: 112.5,
    });
    expect(order.squareFeetWithWaste).toBeCloseTo(110);

    const tileDraft = {
      ...readyDraft(),
      procurementMethod: "email_rep" as const,
      repEmail: ARIZONA_TILE_REP_EMAIL,
      quantity: 100,
      quantityUnit: "square_feet" as const,
      cartonCoverageSquareFeet: 12.5,
      wastePercentage: 10,
    };
    const snapshot = snapshotProcurementDraft(tileDraft);
    const [email] = buildProcurementEmailDrafts("Desert House", [
      {
        id: "55555555-5555-4555-8555-555555555555",
        ...snapshot,
      },
    ]);
    expect(email.body).toContain("Quantity needed: 100 square feet");
    expect(email.body).toContain("Waste: 10%");
    expect(email.body).toContain("Carton coverage: 12.5 square feet per box");
    expect(email.body).toContain("Order quantity: 9 boxes");
    expect(email.body).toContain("Coverage ordered: 112.5 square feet");
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
    expect(isRetryableStatus("drafted")).toBe(false);
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
