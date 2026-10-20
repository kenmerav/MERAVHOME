import { expect, it } from "vitest";
import {
  createDefaultRoomDesignWorkflowState,
  mergeExtensionProductIntoRoomDesignWorkflow,
} from "@/lib/roomDesignWorkflow";
import { mergeRoomDesignEdits, roomDesignStatesEqual } from "@/lib/roomDesignSync";
const product = {
  id: "tile",
  name: "Cotton tile",
  vendor: "Bedrosians",
  finish: "Cotton",
  sourcePageUrl: "https://example.com/cotton",
  imageUrl: "image",
  originalImageUrl: "image",
  price: "$32.89",
  sku: "100010057",
  dimensions: "6 x 6 inches",
  quantity: 1,
};
it("keeps an extension flooring import when the open page saves an unrelated backsplash link", () => {
  const base = createDefaultRoomDesignWorkflowState("Kitchen");
  const local = structuredClone(base);
  local.links.find((x) => x.id === "backsplash")!.url = "https://example.com/backsplash";
  const remote = mergeExtensionProductIntoRoomDesignWorkflow({
    state: base,
    itemKey: "flooring",
    product,
  }).state;
  const result = mergeRoomDesignEdits(base, local, remote);
  expect(result.links.find((x) => x.id === "flooring")?.url).toBe(product.sourcePageUrl);
  expect(result.links.find((x) => x.id === "backsplash")?.url).toBe(
    "https://example.com/backsplash",
  );
  expect(result.selections.find((x) => x.id === "link-flooring")?.productId).toBe("tile");
});
it("keeps a locally edited quantity while adopting the imported link for the same slot", () => {
  const base = createDefaultRoomDesignWorkflowState("Kitchen");
  // The imported quantity is unchanged from the user's saved base quantity.
  base.links.find((x) => x.id === "flooring")!.quantity = 1;
  const local = structuredClone(base);
  local.links.find((x) => x.id === "flooring")!.quantity = 100;
  const remote = mergeExtensionProductIntoRoomDesignWorkflow({
    state: base,
    itemKey: "flooring",
    product,
  }).state;
  expect(
    mergeRoomDesignEdits(base, local, remote).links.find((x) => x.id === "flooring")?.quantity,
  ).toBe(100);
});
it("rejects a simultaneous quantity choice when an extension changes TBD to a number", () => {
  const base = createDefaultRoomDesignWorkflowState("Kitchen");
  const local = structuredClone(base);
  local.links.find((x) => x.id === "flooring")!.quantity = 100;
  const remote = mergeExtensionProductIntoRoomDesignWorkflow({
    state: base,
    itemKey: "flooring",
    product,
  }).state;
  expect(() => mergeRoomDesignEdits(base, local, remote)).toThrow("flooring: quantity");
});
it("rejects conflicting product choices instead of overwriting either silently", () => {
  const base = createDefaultRoomDesignWorkflowState("Kitchen");
  const local = structuredClone(base);
  local.links.find((x) => x.id === "flooring")!.url = "https://example.com/other";
  const remote = mergeExtensionProductIntoRoomDesignWorkflow({
    state: base,
    itemKey: "flooring",
    product,
  }).state;
  expect(() => mergeRoomDesignEdits(base, local, remote)).toThrow("flooring: url");
});
it("does not autosave a hydration solely because its timestamp changed", () => {
  const base = createDefaultRoomDesignWorkflowState("Kitchen");
  expect(roomDesignStatesEqual(base, { ...base, updatedAt: "later" })).toBe(true);
});
