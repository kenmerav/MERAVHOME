import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  accuracyCheckStatus,
  accuracyItemIssues,
  accuracyOutputs,
  accuracyProgress,
  applyAccuracyCommand,
  createAccuracyItem,
  createAccuracyState,
  fieldConfirmed,
  quantityPurchase,
  snapshotChanged,
  type AccuracyCommand,
  type AccuracySource,
  type AccuracyState,
} from "../src/lib/designAccuracy";
import {
  accuracyHandoff,
  accuracyInvoiceTerms,
  accuracyImportCommands,
  accuracyRoomSelections,
  projectMaterialAccuracy,
} from "../src/lib/designAccuracyProjection";
import { accuracyMutationSchema } from "../src/lib/designAccuracySchema";
import { LocalAccuracyStore } from "../src/lib/designAccuracyStore.server";
import { localAccuracyAllowed, designAccuracyApi } from "../src/lib/designAccuracy.server";
import {
  createDefaultRoomDesignWorkflowState,
  mergeRoomDesignSelectionsIntoBoard,
  normalizeRoomDesignWorkflowState,
  type RoomDesignSelection,
} from "../src/lib/roomDesignWorkflow";
import { invoiceQuantityInput, invoiceQuantityNumber } from "../src/lib/specQuantity";
import { parseRoomDesignQuantity, roomDesignQuantityLabel } from "../src/lib/roomDesignQuantity";
import { mergeAutomaticRoomProduct } from "../src/lib/roomDesignAutoScrape";
import type { MaterialItem } from "../src/lib/db";
import { boardMaterialQuantity, boardPageQuantity } from "../src/lib/boardMaterialQuantity";
import { formatMoney, procurementTotals } from "../src/lib/money";

const at = "2026-10-23T17:00:00Z",
  actor = "designer-a";
const source: AccuracySource = {
  id: "brief",
  kind: "brief",
  label: "Approved design brief",
  revision: "R1",
  reference: "Client design decision D-12, island finish and faucet schedule",
};
const drawing: AccuracySource = {
  id: "drawing",
  kind: "document",
  label: "Interior elevations",
  revision: "R1",
  reference: "Vanity faucet callout: two installed faucets",
  documentId: "doc-1",
  sheet: "A-201",
  page: 4,
};
function initial() {
  return createAccuracyState(
    "project-a",
    [
      { id: "kitchen", name: "Kitchen" },
      { id: "bath", name: "Primary Bathroom" },
    ],
    actor,
    at,
  );
}
function apply(state: AccuracyState, ...commands: AccuracyCommand[]) {
  return commands.reduce((s, c) => applyAccuracyCommand(s, c, actor, at), state);
}
function single(category = "Faucet", kind: "retail" | "custom" | "cabinet-finish" = "retail") {
  const state = initial();
  state.rooms = [
    { id: "kitchen", name: "Kitchen", items: [{ ...createAccuracyItem("item", category), kind }] },
  ];
  return apply(
    state,
    { type: "scope", rooms: [{ id: "kitchen", name: "Kitchen" }], source },
    { type: "decision", roomId: "kitchen", itemId: "item", disposition: "select" },
  );
}
function values(
  state: AccuracyState,
  fields: Record<string, string | number | null>,
  confirm = true,
  evidence = source,
) {
  const commands: AccuracyCommand[] = Object.entries(fields).map(([key, value]) => ({
    type: "field",
    roomId: "kitchen",
    itemId: "item",
    key,
    value,
  }));
  if (confirm)
    commands.push({
      type: "confirm",
      roomId: "kitchen",
      itemId: "item",
      keys: Object.keys(fields).filter((k) => fields[k] !== null && fields[k] !== ""),
      source: evidence,
    });
  return apply(state, ...commands);
}
function retail(state = single(), overrides = {}) {
  return values(state, {
    productName: "Bridge faucet",
    manufacturer: "Actual maker",
    sku: "F-BR-1",
    color: "Bronze",
    url: "https://example.com/faucet?variant=bronze",
    imageUrl: "https://example.com/faucet.jpg",
    quantity: 2,
    quantityUnit: "each",
    quantityBasis: "Island elevation K-2, two sink assignments",
    location: "Island",
    ...overrides,
  });
}
const item = (state: AccuracyState) => state.rooms[0].items[0];

describe("design scope and exact selections", () => {
  it("preserves every untouched requirement; one-click exclusions resolve and reverse with history", () => {
    let state = initial();
    const required = state.rooms[0].items[0];
    expect(accuracyProgress(state).designComplete).toBe(false);
    expect(accuracyItemIssues(state, required)).not.toHaveLength(0);
    state = apply(state, {
      type: "decision",
      roomId: "kitchen",
      itemId: required.id,
      disposition: "not-needed",
    });
    expect(accuracyItemIssues(state, item(state))).toEqual([]);
    expect(item(state).decision?.actor).toBe(actor);
    state = apply(state, {
      type: "decision",
      roomId: "kitchen",
      itemId: required.id,
      disposition: "unresolved",
    });
    expect(item(state).decisionHistory[0].disposition).toBe("not-needed");
    expect(accuracyItemIssues(state, item(state)).length).toBeGreaterThan(0);
  });
  it("No tub touches tub/filler only, and explicit presence contradicts exclusion", () => {
    let state = initial();
    state = apply(state, { type: "no-tub", roomId: "bath" });
    const bath = state.rooms[1];
    expect(bath.items.find((i) => /^tub$/i.test(i.category))?.decision?.disposition).toBe(
      "not-needed",
    );
    expect(bath.items.find((i) => /^tub filler$/i.test(i.category))?.decision?.disposition).toBe(
      "not-needed",
    );
    const faucet = bath.items.find((i) => /^faucet/i.test(i.category));
    expect(faucet).toBeDefined();
    expect(faucet?.decision).toBeUndefined();
    const tub = bath.items.find((i) => /^tub$/i.test(i.category))!;
    state = apply(state, {
      type: "check",
      check: {
        id: "presence",
        roomId: "bath",
        itemId: tub.id,
        field: "quantity",
        expected: "required",
        relation: "explicit-presence",
        source: drawing,
        mode: "manual",
      },
    });
    expect(
      accuracyItemIssues(
        state,
        state.rooms[1].items.find((i) => i.id === tub.id)!,
      )[0],
    ).toMatch(/contradicts/);
  });
  it("cabinets require manufacturer, approved finish/sample and application, without fabrication or retail price", () => {
    const state = values(single("Cabinet finish", "cabinet-finish"), {
      manufacturer: "Cabinet manufacturer",
      color: "Natural oak",
      finishCodeOrSample: "Approved sample C-4",
      location: "Perimeter",
    });
    expect(accuracyProgress(state).designComplete).toBe(true);
    expect(item(state).fields.sku).toBeUndefined();
    expect(accuracyProgress(state).procurementReady).toBe(false);
    const stock = values(single("Cabinet finish", "cabinet-finish"), {
      manufacturer: "Actual cabinet maker",
      color: "Natural oak",
      location: "Perimeter",
    });
    expect(accuracyProgress(stock).designComplete).toBe(true);
    const custom = values(single("Cabinet finish", "cabinet-finish"), {
      manufacturer: "Actual cabinet maker",
      color: "Custom stain",
      location: "Island",
    });
    expect(accuracyProgress(custom).designComplete).toBe(false);
  });
  it("requires agreed scope including unentered rooms; another party is retained as an external dependency", () => {
    let state = retail();
    state = apply(state, {
      type: "scope",
      rooms: [
        { id: "kitchen", name: "Kitchen" },
        { id: "casita", name: "Casita bath" },
      ],
      source,
    });
    expect(accuracyProgress(state).missingRooms).toEqual([{ id: "casita", name: "Casita bath" }]);
    expect(accuracyProgress(state).designComplete).toBe(false);
    state = apply(state, {
      type: "decision",
      roomId: "kitchen",
      itemId: "item",
      disposition: "other-party",
      owner: "Cabinet person",
      meravFields: ["color"],
    });
    expect(accuracyProgress(state).external).toEqual(["item"]);
  });
  it("TBD, alternatives and material/sheen/packaging alone are not exact colors; genuine two-tone is allowed", () => {
    expect(() => retail(single(), { color: "TBD" })).toThrow(/Resolve color/);
    for (const color of ["Bronze or black", "Matte", "Wood", "Quartz", "one quart"])
      expect(accuracyProgress(retail(single(), { color })).designComplete).toBe(false);
    expect(
      accuracyProgress(retail(single(), { color: "Black with brass accents" })).designComplete,
    ).toBe(true);
  });
  it("does not require all fixtures to share one finish", () => {
    const state = retail(single(), { color: "Black" });
    state.rooms[0].items.push({ ...structuredClone(item(retail())), id: "brass-item" });
    expect(accuracyProgress(state).designComplete).toBe(true);
  });
  it("nonempty unrelated dimensions cannot satisfy size choices, and mounting center conflicts request clarification", () => {
    let state = retail();
    item(state).sizeRequired = true;
    state = values(state, { overallDimensions: "Box 10 x 20 inches" });
    expect(accuracyItemIssues(state, item(state)).join(" ")).toMatch(/selectedSize/);
    state = values(state, { selectedSize: "small or large" });
    expect(accuracyProgress(state).designComplete).toBe(false);
    state = retail(single("Cabinet pull"), {
      productName: "6-inch pull",
      mountingCenters: "4 inches",
    });
    expect(accuracyItemIssues(state, item(state)).join(" ")).toMatch(/Clarify/);
    expect(item(state).fields.mountingCenters.value).toBe("4 inches");
    state = values(state, {
      dimensionClarification: "Manufacturer diagram D-4: 6-inch overall length, 4-inch centers",
    });
    expect(accuracyProgress(state).designComplete).toBe(true);
  });
  it("custom work completes with its own specification/evidence and no fabricated SKU or URL", () => {
    const state = values(single("Custom console", "custom"), {
      customId: "K-C01",
      specification: "Solid oak console per approved elevation",
      documentation: "Supplier drawing C-01 revision 2",
      color: "Natural oak",
      location: "Kitchen entry",
      quantity: 1,
      quantityUnit: "each",
      quantityBasis: "Entry elevation K-4 shows one console",
    });
    expect(accuracyProgress(state).designComplete).toBe(true);
  });
  it("included components need a real parent association and cited evidence; no duplicate product is created", () => {
    let state = retail();
    state = apply(state, {
      type: "companion",
      roomId: "kitchen",
      itemId: "item",
      companion: { id: "drain", label: "Drain" },
    });
    expect(accuracyProgress(state).designComplete).toBe(false);
    state = apply(state, {
      type: "companion",
      roomId: "kitchen",
      itemId: "item",
      companion: { id: "drain", label: "Drain", disposition: "included", parentId: "item", source },
    });
    expect(accuracyProgress(state).designComplete).toBe(true);
    expect(state.rooms[0].items).toHaveLength(1);
  });
});

describe("quantities, units and canonical output", () => {
  it("board helpers keep missing counts unknown and count repeated canonical views once", () => {
    expect(boardMaterialQuantity({}).quantity).toBeNull();
    expect(boardPageQuantity([{}, {}])).toBeNull();
    expect(
      boardPageQuantity([
        {
          id: "front",
          designAccuracySourceId: "faucet",
          materialQuantity: 2,
          materialQuantityUnit: "each",
        },
        {
          id: "side",
          designAccuracySourceId: "faucet",
          materialQuantity: 2,
          materialQuantityUnit: "each",
        },
      ]),
    ).toBe(2);
  });
  it("does not turn unknown procurement quantities into a one-item financial total", () => {
    const totals = procurementTotals([
      { material: { quantity: null }, room_product: { product: { price: "80" } } },
    ]);
    expect(totals.unknownQuantities).toBe(1);
    expect(formatMoney(totals.total)).toBe("TBD");
  });
  it("a suggested quantity is not a confirmed count; unknown quantities remain unknown through existing draft/board/invoice paths", () => {
    let state = retail();
    state = values(state, { quantity: null }, false);
    expect(accuracyOutputs(state)[0].quantity).toBeNull();
    expect(quantityPurchase(state, item(state))).toBeNull();
    expect(invoiceQuantityInput({ quantity: null })).toBe("");
    expect(invoiceQuantityNumber("TBD")).toBeNull();
    expect(parseRoomDesignQuantity(undefined)).toBeNull();
    expect(roomDesignQuantityLabel(undefined)).toBe("TBD");
    const draft = createDefaultRoomDesignWorkflowState("Kitchen");
    draft.selections = [
      {
        id: "s",
        category: "Faucet",
        productName: "Faucet",
        vendor: "Dealer",
        finish: "Bronze",
        source: "Product link",
        state: "selected",
        swatch: "#fff",
        imageUrl: "https://example.com/image",
      },
    ];
    const normalized = normalizeRoomDesignWorkflowState(JSON.parse(JSON.stringify(draft)), draft);
    expect(normalized.selections[0].quantity).toBeNull();
    const board = mergeRoomDesignSelectionsIntoBoard({
      boardState: {},
      projectName: "Local",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: normalized.selections,
    });
    expect(
      board.pages.flatMap((p) => p.elements).find((e) => e.type === "image")?.materialQuantity,
    ).toBeNull();
    state = retail();
    state = values(state, { quantityBasis: "Unconfirmed default" });
    expect(accuracyProgress(state).designComplete).toBe(false);
  });
  it("requires sourced coverage and explicit approved waste; box prices stay box prices and purchase packs round up", () => {
    let state = retail(single(), { quantity: 103, quantityUnit: "sq ft" });
    expect(quantityPurchase(state, item(state))).toBeNull();
    state = values(state, {
      purchaseUnit: "box",
      wastePercent: 10,
      packCoverage: 12,
      coverageUnit: "sq ft",
      sellingIncrement: 1,
      fieldRequired: "no",
      price: 80,
      priceUnit: "box",
    });
    expect(quantityPurchase(state, item(state))).toBe(10);
    expect(accuracyOutputs(state)[0]).toMatchObject({
      quantity: 103,
      quantityUnit: "sq ft",
      price: 80,
      priceUnit: "box",
      purchaseQuantity: 10,
    });
    state = values(state, { fieldRequired: "yes" });
    expect(quantityPurchase(state, item(state))).toBeNull();
    state = values(state, { fieldTakeoff: "GC field measurement takeoff T-04, 103 sq ft" });
    expect(quantityPurchase(state, item(state))).toBe(10);
  });
  it("does not count shared totals again and flags duplicate installation IDs / inconsistent allocations", () => {
    const state = retail(single(), { quantity: 4, quantityRole: "shared-total" });
    const total = structuredClone(item(state));
    const allocation = {
      ...total,
      id: "allocation",
      fields: {
        ...total.fields,
        quantityRole: { value: "allocation", history: [] },
        sharedProductId: { value: "item", history: [] },
      },
    };
    state.rooms[0].items.push(allocation);
    expect(accuracyOutputs(state)).toHaveLength(1);
    expect(accuracyProgress(state).allocationIssues).toEqual([]);
    allocation.fields.quantity.value = 2;
    expect(accuracyProgress(state).allocationIssues.length).toBeGreaterThan(0);
    item(state).fields.installationId = { value: "island-faucet-1", history: [] };
    allocation.fields.installationId = { value: "island-faucet-1", history: [] };
    expect(accuracyProgress(state).allocationIssues.join(" ")).toMatch(/Repeated installation/);
  });
  it("uses identical versioned values for board/spec/handoff and flags issued snapshots after changes", () => {
    let state = retail();
    state = apply(state, { type: "snapshot", id: "issued", kind: "design-approved" });
    const reloaded = JSON.parse(JSON.stringify(state));
    expect(accuracyHandoff(reloaded, "board").rows).toEqual(accuracyHandoff(reloaded, "spec").rows);
    expect(accuracyHandoff(reloaded, "spec").rows).toEqual(
      accuracyHandoff(reloaded, "drawing-handoff").rows,
    );
    state = values(state, { color: "Black" }, false);
    expect(snapshotChanged(state, state.snapshots[0])).toBe(true);
    expect(state.snapshots[0].rows[0].color).toBe("Bronze");
    const fact = accuracyOutputs(state)[0];
    expect(
      projectMaterialAccuracy({
        product: { name: "Old", finish: "Old" },
        design_accuracy_fact: fact,
      } as unknown as MaterialItem).color,
    ).toBe("Black");
  });
});

describe("drawing evidence, dependencies and revision history", () => {
  it("no evidence never becomes a pass; a cited comparison is requirement-specific with manual attribution", () => {
    let state = retail();
    expect(accuracyProgress(state).drawing).toBe("pending");
    state = apply(state, {
      type: "check",
      check: {
        id: "count",
        roomId: "kitchen",
        itemId: "item",
        field: "quantity",
        relation: "equals",
        expected: 2,
        source: drawing,
        mode: "manual",
      },
    });
    expect(accuracyCheckStatus(state, state.checks[0])).toBe("matched");
    expect(accuracyProgress(state).drawing).toBe("pending");
    expect(state.checks[0]).toMatchObject({ actor, at, source: { sheet: "A-201", page: 4 } });
    state = apply(state, {
      type: "check",
      check: { ...state.checks[0], id: "width", field: "width", expected: 20, unit: "inches" },
    });
    expect(accuracyCheckStatus(state, state.checks[1])).toBe("unknown");
  });
  it("invalidates only actual dependencies, including source revisions; a reviewed flag cannot clear conflicts", () => {
    let state = retail();
    state = apply(
      state,
      { type: "source", source: drawing },
      {
        type: "check",
        check: {
          id: "count",
          roomId: "kitchen",
          itemId: "item",
          field: "quantity",
          relation: "equals",
          expected: 2,
          source: drawing,
          mode: "manual",
        },
      },
    );
    state = values(state, { color: "Black" });
    expect(accuracyCheckStatus(state, state.checks[0])).toBe("matched");
    state = values(state, { quantity: 3 });
    expect(accuracyCheckStatus(state, state.checks[0])).toBe("stale");
    state = apply(state, { type: "check", check: { ...state.checks[0], expected: 2 } });
    expect(accuracyCheckStatus(state, state.checks[0])).toBe("conflict");
    expect(() => apply(state, { type: "snapshot", id: "forged", kind: "design-approved" })).toThrow(
      /Unresolved/,
    );
    state = apply(state, { type: "source", source: { ...drawing, revision: "R2" } });
    expect(accuracyCheckStatus(state, state.checks[0])).toBe("stale");
    expect(item(state).fields.color.history.length).toBeGreaterThan(0);
  });
  it("project defaults remain proposed, preserve room exceptions and stale inherited confirmations after default revision", () => {
    let state = retail();
    const defaults = { ...source, id: "grout-default", kind: "default" as const };
    state = apply(
      state,
      { type: "default", id: "grout", key: "grout", value: "Warm gray", source: defaults },
      { type: "inherit", roomId: "kitchen", itemId: "item", defaultId: "grout" },
    );
    expect(fieldConfirmed(state, item(state), "grout")).toBe(false);
    state = apply(state, {
      type: "confirm",
      roomId: "kitchen",
      itemId: "item",
      keys: ["grout"],
      source: defaults,
    });
    expect(fieldConfirmed(state, item(state), "grout")).toBe(true);
    state = apply(state, {
      type: "default",
      id: "grout",
      key: "grout",
      value: "White",
      source: { ...defaults, revision: "R2" },
    });
    expect(fieldConfirmed(state, item(state), "grout")).toBe(false);
    state = values(state, { grout: "Room exception taupe" });
    state = apply(state, {
      type: "default",
      id: "grout",
      key: "grout",
      value: "Black",
      source: { ...defaults, revision: "R3" },
    });
    expect(fieldConfirmed(state, item(state), "grout")).toBe(true);
  });
  it("a large 250-room / 900-page partial job explicitly remains incomplete", () => {
    const state = createAccuracyState(
      "large-project",
      Array.from({ length: 250 }, (_, i) => ({ id: `r${i}`, name: `Bedroom ${i}` })),
      actor,
      at,
    );
    const next = apply(
      state,
      { type: "source", source: drawing },
      {
        type: "coverage",
        coverage: {
          sourceId: drawing.id,
          revision: drawing.revision,
          expected: Array.from({ length: 900 }, (_, i) => `page-${i + 1}`),
          processed: ["page-1"],
          failed: ["page-2"],
          cancelled: false,
        },
      },
    );
    expect(next.rooms).toHaveLength(250);
    expect(accuracyProgress(next).incompleteCoverage[0].expected.length).toBe(900);
    expect(accuracyProgress(next).designComplete).toBe(false);
  });
});

describe("imports, authorization and persistence", () => {
  it("puts link facts into the existing item as editable drafts, without confirming them or inventing a quantity", () => {
    let state = single();
    const selection = {
      id: "link-1",
      category: "Faucet",
      productName: "Bridge faucet",
      vendor: "Retailer",
      finish: "Bronze",
      url: "https://example.com/bronze",
      source: "Product link",
      state: "selected",
      swatch: "",
      quantity: null,
    } as RoomDesignSelection;
    state = apply(state, ...accuracyImportCommands(state, "kitchen", [selection]));
    expect(state.rooms[0].items).toHaveLength(1);
    expect(item(state).selectionId).toBe("link-1");
    expect(item(state).fields.productName.value).toBe("Bridge faucet");
    expect(item(state).fields.color.value).toBe("Bronze");
    expect(item(state).fields.quantity?.value ?? null).toBeNull();
    expect(item(state).fields.manufacturer).toBeUndefined();
    expect(fieldConfirmed(state, item(state), "color")).toBe(false);
    expect(accuracyItemIssues(state, item(state)).length).toBeGreaterThan(0);
    expect(accuracyImportCommands(state, "kitchen", [selection])).toEqual([]);
  });
  it("keeps manual item answers when links refresh and projects the confirmed brand back to its product card", () => {
    let state = retail();
    const selection = {
      id: "link-1",
      category: "Faucet",
      productName: "Faucet",
      vendor: "Retailer",
      finish: "Bronze",
      url: "https://example.com/bronze",
      source: "Product link",
      state: "selected",
      swatch: "",
      quantity: 1,
    } as RoomDesignSelection;
    state = apply(state, ...accuracyImportCommands(state, "kitchen", [selection]));
    state = values(
      state,
      { manufacturer: "Actual faucet maker", color: "Bronze and black" },
      false,
    );
    state = apply(state, ...accuracyImportCommands(state, "kitchen", [selection]));
    expect(item(state).fields.color.value).toBe("Bronze and black");
    expect(item(state).fields.color.proposal).toBe("Bronze");
    const [card] = accuracyRoomSelections(state, "kitchen", [selection]);
    expect(card.vendor).toBe("Actual faucet maker");
    expect(card.finish).toBe("Bronze and black");
  });
  it("carries installation answers from the original link checklist into the product's required questions", () => {
    const state = single("Shower wall tile");
    const selection = {
      id: "tile",
      category: "Shower wall tile",
      productName: "Tile",
      vendor: "Supplier",
      finish: "White",
      source: "Product link",
      state: "selected",
      swatch: "",
      notes: "Grout color: MAPEI Avalanche\nGrout joint width: 1/8 inch\nTile layout: Stacked",
    } as RoomDesignSelection;
    const next = apply(state, ...accuracyImportCommands(state, "kitchen", [selection]));
    expect(item(next).fields.grout.value).toBe("MAPEI Avalanche");
    expect(item(next).fields.joint.value).toBe("1/8 inch");
    expect(item(next).fields.layout.value).toBe("Stacked");
    expect(fieldConfirmed(next, item(next), "grout")).toBe(false);
  });
  it("requires real authorization for project reads even when a project ID is known", async () => {
    const result = await designAccuracyApi(
      new Request(
        "http://localhost/api/design-accuracy?projectId=527d1356-919b-48b9-877e-1924c766282b",
      ),
    );
    expect(result.status).toBe(401);
  });
  it("cannot silently replace a canonical selection from a delayed scrape", () => {
    const current = {
      id: "s1",
      category: "Faucet",
      productName: "Approved",
      vendor: "Dealer",
      source: "Product link",
      finish: "Bronze",
      state: "locked",
      swatch: "",
      url: "https://example.com/faucet",
      quantity: 2,
      accuracySource: { id: "canonical", version: 3 },
    } as RoomDesignSelection;
    const result = mergeAutomaticRoomProduct(
      { ...current, finish: "Black", quantity: 1 },
      current,
      current,
      { url: current.url!, quantity: 1, notes: "" },
    );
    expect(result?.finish).toBe("Bronze");
    expect(result?.quantity).toBe(2);
    expect(result?.scrapeError).toMatch(/proposals/);
  });
  it("flags contradictory cabinet and variant finish evidence, without correcting unrelated mixed metals", () => {
    const state = retail(single(), { supplierColor: "Bronze", color: "Black" });
    expect(accuracyItemIssues(state, item(state)).join(" ")).toMatch(
      /conflicts with the cited exact variant/,
    );
    const cabinets = values(single("Cabinet finish", "cabinet-finish"), {
      manufacturer: "Actual maker",
      color: "Natural oak",
      supplierColor: "Espresso",
      finishCodeOrSample: "Sample C-02",
      location: "Island",
    });
    expect(accuracyProgress(cabinets).designComplete).toBe(false);
  });
  it("legacy imports are proposals; exact variants with reused SKU/family URLs stay distinct and confirmed choices survive refresh", () => {
    let state = retail();
    const selection = {
      id: "s-1",
      category: "Faucet",
      productName: "Faucet",
      finish: "Black",
      url: "https://example.com/family",
      sku: "REUSED",
      state: "locked",
      source: "Product link",
      vendor: "Dealer",
      swatch: "",
      quantity: 1,
    } as RoomDesignSelection;
    state = apply(
      state,
      ...accuracyImportCommands(state, "kitchen", [
        selection,
        { ...selection, id: "s-2", finish: "Chrome" },
      ]),
    );
    expect(item(state).fields.color.value).toBe("Bronze");
    expect(item(state).fields.color.proposal).toBe("Black");
    expect(state.rooms[0].items).toHaveLength(2);
    expect(fieldConfirmed(state, item(state), "color")).toBe(true);
    const projected = accuracyRoomSelections(state, "kitchen", [selection]);
    expect(projected[0].finish).toBe("Bronze");
  });
  it("rejects forged flags, unsupported commands and malicious keys; local endpoints are disabled on live origins", async () => {
    expect(
      accuracyMutationSchema.safeParse({
        expectedRevision: 0,
        commands: [{ type: "snapshot", id: "fake", kind: "design-approved", complete: true }],
      }).success,
    ).toBe(false);
    expect(
      accuracyMutationSchema.safeParse({
        expectedRevision: 0,
        commands: [
          { type: "field", roomId: "kitchen", itemId: "item", key: "__proto__", value: "x" },
        ],
      }).success,
    ).toBe(false);
    expect(
      localAccuracyAllowed(new Request("https://studio.meravinteriors.com/api/design-accuracy")),
    ).toBe(false);
    const result = await designAccuracyApi(
      new Request(
        "https://studio.meravinteriors.com/api/design-accuracy?projectId=local-design-accuracy",
      ),
    );
    expect(result.status).toBe(404);
  });
  it("local CAS persistence survives reload and rejects concurrent / stale confirmations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "accuracy-test-"));
    try {
      const store = new LocalAccuracyStore(directory),
        state = await store.read();
      const next = await store.mutate(state.revision, (s) =>
        apply(s, { type: "no-tub", roomId: "bath" }),
      );
      expect((await new LocalAccuracyStore(directory).read()).revision).toBe(next.revision);
      await expect(store.mutate(0, (s) => s)).rejects.toThrow(/newer/);
      const results = await Promise.allSettled([
        store.mutate(next.revision, (s) => apply(s, { type: "no-tub", roomId: "bath" })),
        store.mutate(next.revision, (s) => apply(s, { type: "no-tub", roomId: "bath" })),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
