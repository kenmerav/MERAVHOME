import { expect, it } from "vitest";
import {
  roomDesignProductGaps,
  roomDesignSelectionIssues,
  roomDesignStepForAccess,
} from "@/lib/roomDesignReview";
import {
  createDefaultRoomDesignWorkflowState,
  normalizeRoomDesignWorkflowState,
  type RoomDesignSelection,
} from "@/lib/roomDesignWorkflow";

const product = (patch: Partial<RoomDesignSelection> = {}): RoomDesignSelection => ({
  id: "fixture",
  category: "Mirror",
  productName: "Arched wall mirror",
  vendor: "Supplier",
  source: "Product link",
  state: "selected",
  swatch: "",
  quantity: 1,
  url: "https://example.com/mirror",
  imageUrl: "https://example.com/mirror.jpg",
  finish: "Brass",
  dimensions: "24 x 36 inches",
  price: "$200.00",
  ...patch,
});

it("skips rendering for the team while keeping Ken’s render navigation and other stages intact", () => {
  expect(roomDesignStepForAccess(3, false)).toBe(4);
  expect(roomDesignStepForAccess(3, true)).toBe(3);
  for (const stage of [0, 1, 2, 4, 5]) expect(roomDesignStepForAccess(stage, false)).toBe(stage);
});

it("keeps precise repair callouts until the corresponding product information is filled", () => {
  const missing = product({ finish: "TBD", price: "$100–$200", dimensions: "" });
  expect(roomDesignProductGaps(missing).map((gap) => gap.field)).toEqual([
    "finish",
    "dimensions",
    "price",
  ]);
  const corrected = { ...missing, finish: "Brass", dimensions: "24 x 36 inches", price: "$200" };
  expect(roomDesignProductGaps(corrected)).toEqual([]);
  expect(roomDesignSelectionIssues(corrected)).toEqual([]);
  const state = createDefaultRoomDesignWorkflowState("Primary Bathroom");
  state.selections = [corrected];
  expect(
    roomDesignProductGaps(
      normalizeRoomDesignWorkflowState(JSON.parse(JSON.stringify(state)), state).selections[0],
    ),
  ).toEqual([]);
});

it("detects missing names, vendor, link and image even if the scrape claims completion", () => {
  expect(
    roomDesignProductGaps(
      product({
        productName: "Mirror selection",
        vendor: "Linked vendor",
        url: "",
        imageUrl: "",
        scrapeStatus: "complete",
      }),
    ).map((gap) => gap.field),
  ).toEqual(["productName", "vendor", "url", "imageUrl"]);
});

it("uses existing pricing exemptions and does not demand optional SKU or every dimension", () => {
  for (const category of ["Countertop", "Wall paint", "Cabinet finish"]) {
    expect(
      roomDesignProductGaps(
        product({ category, productName: category, price: "", dimensions: "" }),
      ),
    ).toEqual([]);
  }
  expect(
    roomDesignProductGaps(product({ category: "Cabinet hardware", price: "" })).map(
      (gap) => gap.field,
    ),
  ).toContain("price");
  expect(
    roomDesignProductGaps(
      product({ category: "Hooks", productName: "Hooks for within cabinets", price: "" }),
    ).map((gap) => gap.field),
  ).toContain("price");
  expect(roomDesignProductGaps(product({ sku: "" }))).toEqual([]);
  expect(roomDesignProductGaps(product({ category: "Towel hook", dimensions: "" }))).toEqual([]);
});

it("does not flag product metadata on excluded or instruction-only items", () => {
  for (const notes of [
    "Selection responsibility: Not needed",
    "Selection responsibility: By builder",
  ]) {
    expect(roomDesignProductGaps(product({ notes, price: "", finish: "" }))).toEqual([]);
  }
});
