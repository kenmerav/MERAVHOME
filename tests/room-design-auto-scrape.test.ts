import { expect, it } from "vitest";
import { mergeAutomaticRoomProduct, roomDesignLinkSourceKey } from "@/lib/roomDesignAutoScrape";
import type { RoomDesignSelection } from "@/lib/roomDesignWorkflow";

const item = (patch: Partial<RoomDesignSelection> = {}): RoomDesignSelection => ({
  id: "link-sink",
  category: "Sink",
  productName: "Sink",
  vendor: "Supplier",
  source: "Product link",
  state: "selected",
  swatch: "",
  url: "https://example.com/sink",
  finish: "White",
  quantity: 1,
  price: "",
  ...patch,
});
const link = {
  id: "sink",
  url: "https://example.com/sink",
  quantity: 2,
  notes: "Tile layout: Custom arrangement",
};

it("rejects a delayed result after the product URL changes", () => {
  expect(
    mergeAutomaticRoomProduct(item(), undefined, undefined, {
      ...link,
      url: "https://example.com/replacement",
    }),
  ).toBeNull();
  expect(roomDesignLinkSourceKey(link)).not.toBe(
    roomDesignLinkSourceKey({ ...link, productId: "another-product" }),
  );
  expect(roomDesignLinkSourceKey(link)).toBe(
    roomDesignLinkSourceKey({ ...link, url: ` ${link.url} ` }),
  );
});

it("retains quantity, installation notes and manual edits made during the lookup", () => {
  const before = item({ price: "$100", quantityUnit: "each", notes: "" });
  const current = item({
    price: "$125",
    quantityUnit: "each",
    materialsSyncStatus: "changed",
    reviewFields: ["price"],
  });
  const next = mergeAutomaticRoomProduct(
    item({ price: "$110", productName: "Scraped sink", sku: "S-1" }),
    before,
    current,
    link,
  )!;
  expect(next.productName).toBe("Scraped sink");
  expect(next.sku).toBe("S-1");
  expect(next.price).toBe("$125");
  expect(next.quantity).toBe(2);
  expect(next.notes).toBe(link.notes);
  expect(next.reviewFields).toContain("price");
  expect(next.materialsSyncStatus).toBe("changed");
});

it("does not restore cleared choices or invent a missing price", () => {
  const before = item({ finish: "Brass", notes: "Selected color / finish: Brass" });
  const current = item({ finish: "", notes: "" });
  const next = mergeAutomaticRoomProduct(item({ finish: "Brass" }), before, current, {
    ...link,
    notes: "",
  })!;
  expect(next.finish).toBe("");
  expect(next.price).toBe("");
  expect(next.reviewFields).toContain("finish");
});

it("keeps a published paint sheen in the gathered review without replacing manual installation notes", () => {
  for (const [notes, expected] of [
    ["", "Eggshell"],
    ["Paint sheen: Satin", "Satin"],
  ]) {
    const next = mergeAutomaticRoomProduct(
      item({ category: "Wall finish", productName: "Interior paint", finish: "White / Eggshell" }),
      undefined,
      undefined,
      { ...link, notes },
    )!;
    expect(next.notes).toBe(`Paint sheen: ${expected}`);
  }
});

it("carries new page facts into versioned cards while preserving existing designer choices", () => {
  const current = item({
    accuracySource: { id: "sink", version: 1 },
    finish: "Ivory",
    dimensions: undefined,
  });
  const result = mergeAutomaticRoomProduct(
    item({
      finish: "White",
      manufacturer: "Sink Maker",
      dimensions: "24 in W",
      colorOptions: ["White", "Ivory"],
    }),
    current,
    current,
    link,
  )!;
  expect(result.finish).toBe("Ivory");
  expect(result.scrapeFacts).toMatchObject({
    manufacturer: "Sink Maker",
    finish: "White",
    dimensions: "24 in W",
  });
  expect(result.colorOptions).toEqual(["White", "Ivory"]);
});
