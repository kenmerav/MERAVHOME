import { expect, it } from "vitest";
import {
  roomDesignProductGaps,
  roomDesignSelectionIssues,
  roomDesignStepForAccess,
  roomDesignConfirmationMessage,
  roomDesignOrderReady,
  confirmRoomDesignSelection,
  roomDesignReviewBlockers,
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
  const missing = product({
    finish: "TBD",
    price: "$100–$200",
    dimensions: "",
    sizeOptions: ["24 x 36 inches", "30 x 40 inches"],
  });
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

it("does not require dimensions without an unresolved published size choice", () => {
  expect(roomDesignProductGaps(product({ dimensions: "" }))).toEqual([]);
  expect(roomDesignProductGaps(product({ dimensions: "", sizeOptions: ["Large"] }))).toEqual([]);
  expect(
    roomDesignProductGaps(product({ dimensions: "", sizeOptions: ["Large", "LARGE"] })),
  ).toEqual([]);
  expect(
    roomDesignProductGaps(
      product({ dimensions: "", sizeOptions: ["Small", "Large"], selectedSize: "Large" }),
    ),
  ).toEqual([]);
  expect(
    roomDesignProductGaps(product({ dimensions: "", sizeOptions: ["Small", "Large"] })).map(
      (gap) => gap.label,
    ),
  ).toEqual(["Selected size"]);
});

it("ignores stale partial scrape warnings once all actual requirements are met", () => {
  const complete = product({
    category: "Wall paint",
    productName: "Paint",
    price: "",
    dimensions: "",
    scrapeStatus: "partial",
    scrapeError: "Color/finish needs review.",
  });
  expect(roomDesignSelectionIssues(complete)).toEqual([]);
  expect(roomDesignConfirmationMessage(complete)).toBe("");
  expect(
    roomDesignProductGaps(
      product({
        category: "Countertop",
        productName: "Quartz",
        price: "",
        dimensions: "",
        scrapeStatus: "partial",
      }),
    ),
  ).toEqual([]);
  expect(
    roomDesignOrderReady(product({ state: "locked", sku: "M-1", scrapeStatus: "partial" })),
  ).toBe(true);
});

it("keeps changed fields and uncertain product matches explicit until confirmed", () => {
  const changed = product({ scrapeStatus: "partial", reviewFields: ["finish", "price"] });
  expect(roomDesignProductGaps(changed)).toEqual([]);
  expect(roomDesignConfirmationMessage(changed)).toBe("Confirm changes: Color / finish, Price.");
  expect(roomDesignOrderReady({ ...changed, state: "locked", sku: "M-1" })).toBe(false);
  expect(
    roomDesignConfirmationMessage({
      ...changed,
      reviewFields: undefined,
      scrapeError: undefined,
      scrapeStatus: "complete",
    }),
  ).toBe("");
  expect(
    roomDesignConfirmationMessage(
      product({ scrapeError: "This is a collection page. Use the exact product page." }),
    ),
  ).toContain("collection page");
  expect(roomDesignConfirmationMessage(product({ scrapeStatus: "failed" }))).toContain(
    "automatic lookup did not finish",
  );
  expect(
    roomDesignConfirmationMessage(product({ scrapeError: "Review the edited product details." })),
  ).toBe("Confirm the edited product details.");
  expect(
    roomDesignConfirmationMessage(
      product({ notes: "Selection responsibility: Not needed", reviewFields: ["price"] }),
    ),
  ).toBe("");
});

it("persists the exact confirmation fields and published size choices in saved reviews", () => {
  const state = createDefaultRoomDesignWorkflowState("Kitchen");
  state.selections = [
    product({ sizeOptions: ["Small", "Large"], selectedSize: "Large", reviewFields: ["price"] }),
  ];
  const saved = normalizeRoomDesignWorkflowState(JSON.parse(JSON.stringify(state)), state)
    .selections[0];
  expect(saved.sizeOptions).toEqual(["Small", "Large"]);
  expect(saved.selectedSize).toBe("Large");
  expect(roomDesignConfirmationMessage(saved)).toBe("Confirm changes: Price.");
});

it("confirms changes, acknowledges displayed fit checks and marks reviewed in one saved update", () => {
  const changed = product({
    scrapeStatus: "partial",
    scrapeError: "Review the edited product details.",
    reviewFields: ["finish", "price"],
    notes:
      "Keep the existing mounting location.\nRelated change review: Recheck fit after Vanity layout changed.",
  });
  expect(roomDesignReviewBlockers(changed)).toEqual([]);
  const reviewed = confirmRoomDesignSelection(changed);
  expect(reviewed.state).toBe("locked");
  expect(reviewed.scrapeStatus).toBe("complete");
  expect(reviewed.reviewFields).toBeUndefined();
  expect(reviewed.scrapeError).toBeUndefined();
  expect(reviewed.notes).toBe("Keep the existing mounting location.");
  expect(roomDesignConfirmationMessage(reviewed)).toBe("");
  expect(roomDesignSelectionIssues(reviewed)).toEqual([]);
  expect(changed.notes).toContain("Related change review");
  const state = createDefaultRoomDesignWorkflowState("Bathroom");
  state.selections = [reviewed];
  expect(
    normalizeRoomDesignWorkflowState(JSON.parse(JSON.stringify(state)), state).selections[0].state,
  ).toBe("locked");
});

it("keeps required product, quantity and tile decisions blocking the combined confirmation", () => {
  for (const item of [
    product({ imageUrl: "" }),
    product({ quantity: null }),
    product({ category: "Shower wall tile", productName: "Ceramic tile", quantityUnit: "sq ft" }),
    product({ notes: "Measurement status: Field measurement needed" }),
  ]) {
    expect(roomDesignReviewBlockers(item).length).toBeGreaterThan(0);
    expect(() => confirmRoomDesignSelection(item)).toThrow();
    expect(item.state).toBe("selected");
  }
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

it("allows blank prices for all room products without treating them as zero", () => {
  for (const category of [
    "Countertop",
    "Wall paint",
    "Cabinet finish",
    "Cabinet hardware",
    "Hooks",
    "Cabinet interior lighting",
    "Toilet",
    "Mirror",
  ]) {
    expect(
      roomDesignProductGaps(
        product({ category, productName: category, price: "", dimensions: "" }),
      ),
    ).toEqual([]);
    const reviewed = confirmRoomDesignSelection(
      product({ category, productName: category, price: "" }),
    );
    expect(reviewed.price).toBe("");
    expect(reviewed.state).toBe("locked");
    expect(roomDesignOrderReady(reviewed)).toBe(false);
  }
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
