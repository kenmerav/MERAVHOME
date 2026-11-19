import { describe, expect, it } from "vitest";
import type { MaterialItem } from "@/lib/db";
import {
  boardMaterialFieldsForChanges, boardMaterialWasRemoved, planBoardMaterialLayer,
  type BoardMaterialSnapshotItem,
} from "@/lib/boardMaterialChanges";
import { boardMaterialsFingerprint } from "@/lib/boardMaterialsSnapshot";
import { planMaterialBoardLink } from "@/lib/materialBoardLink";
import { clientProductNameForBoardSync } from "@/lib/clientProductName";

function layer(id: string, link: string): BoardMaterialSnapshotItem {
  return {
    id, src: `https://images.example/${id}.jpg`, label: id, notes: null, link,
    materialLinkCleared: false, productId: `product-${id}`, productName: id, finish: null,
    materialRoomId: "living", materialCategory: "Furniture", materialQuantity: 1,
    materialFinish: null, materialDimensions: null, materialInfoNotNeeded: false,
    materialInfoSkipApproved: false, materialExcludeFromMaterials: false,
  };
}
const material = (id: string, patch: Partial<MaterialItem> = {}) => ({
  id: `material-${id}`, project_id: "project", room_id: "living",
  source_board_id: "project", source_board_page_id: "page", source_board_element_id: id,
  not_needed: false, ...patch,
}) as MaterialItem;
const asImage = (item: BoardMaterialSnapshotItem) => ({
  ...item, type: "image", materialItemId: `material-${item.id}`,
});

describe("sending board changes after a Spec Book edit", () => {
  it("updates the generated client name when only the board room changes", () => {
    const before = layer("mirror", "https://example.com/mirror");
    const { changes } = planBoardMaterialLayer(before, before, "powder-2", "powder-1", true);
    const saved = { item_label: "mirror", client_product_name: "Powder Room 2 mirror" };
    const patch = boardMaterialFieldsForChanges({
      room_id: "powder-1",
      item_label: "mirror",
      client_product_name: clientProductNameForBoardSync(
        saved, "Powder Room 2", "Powder Bathroom", "mirror",
      ),
      quantity: 1,
      product_url: before.link,
      notes: "Old note",
    }, changes, false);
    expect(patch).toEqual({
      room_id: "powder-1", client_product_name: "Powder Bathroom mirror",
    });
  });

  it("keeps a custom description while replacing its previous room prefix", () => {
    expect(clientProductNameForBoardSync(
      { item_label: "mirror", client_product_name: "Powder Bathroom oval brass mirror" },
      "Powder Bathroom", "Powder Room 2", "mirror",
    )).toBe("Powder Room 2 oval brass mirror");
    expect(clientProductNameForBoardSync(
      { item_label: "mirror", client_product_name: "Custom oval brass mirror" },
      "Powder Bathroom", "Powder Room 2", "mirror",
    )).toBe("Custom oval brass mirror");
  });

  it("replaces a generated unlabeled name and handles simultaneous room and label changes", () => {
    expect(clientProductNameForBoardSync(
      { item_label: "vanity stone", client_product_name: "Powder Room 2 Unlabeled Item" },
      "Powder Room 2", "Powder Bathroom", "vanity stone",
    )).toBe("Powder Bathroom vanity stone");
    const { changes } = planBoardMaterialLayer(
      layer("old-label", ""), { ...layer("old-label", ""), label: "new-label" },
      "powder-2", "powder-1", true,
    );
    const saved = { item_label: "old-label", client_product_name: "Powder Room 2 old-label" };
    expect(boardMaterialFieldsForChanges({
      room_id: "powder-1", item_label: "new-label",
      client_product_name: clientProductNameForBoardSync(
        saved, "Powder Room 2", "Powder Bathroom", "new-label",
      ),
    }, changes, false)).toEqual({
      room_id: "powder-1", item_label: "new-label", client_product_name: "Powder Bathroom new-label",
    });
  });

  it("preserves the couch after a link correction and only sends the added/removed end table", () => {
    const couch = layer("couch", "https://example.com/old-couch");
    const oldTable = layer("old-table", "https://example.com/old-table");
    const newTable = layer("new-table", "https://example.com/new-table");
    const savedCouch = material("couch", {
      product_url: "https://example.com/correct-couch", quantity: 3, notes: "Keep upholstery note",
      product: { price: "1950" } as MaterialItem["product"],
    });
    const before = {
      version: 1 as const, title: "Living Room", roomId: "living",
      hidden: false, roomApprovalStatus: null, materialImages: [couch, oldTable],
    };
    const state = { pages: [{
      id: "page", roomId: "living", elements: [asImage(couch), asImage(newTable)],
      materialsSyncSnapshot: before,
    }] };
    const mirror = planMaterialBoardLink(state, "project", savedCouch, couch.link!, savedCouch.product_url!);
    expect(mirror).toMatchObject({ changed: 1, conflicts: 0 });
    const page = (mirror.board as typeof state).pages[0];
    expect(page.elements[0]).toMatchObject({
      link: savedCouch.product_url, src: couch.src, materialQuantity: 1,
    });
    expect(page.materialsSyncSnapshot.materialImages[1]).toEqual(oldTable);
    const send = page.elements.filter((item) => planBoardMaterialLayer(
      page.materialsSyncSnapshot.materialImages.find((saved) => saved.id === item.id),
      item, "living", "living", item.id === "couch",
    ).send);
    expect(send.map(({ id }) => id)).toEqual(["new-table"]);
    const active = new Set(page.elements.map(({ id }) => id));
    const removed = [savedCouch, material("old-table")].filter((item) =>
      boardMaterialWasRemoved(item, "project", new Set(["page"]), active, new Set([savedCouch.id])),
    );
    expect(removed.map(({ id }) => id)).toEqual(["material-old-table"]);
    expect(savedCouch).toMatchObject({ quantity: 3, notes: "Keep upholstery note", product: { price: "1950" } });
    expect(state.pages[0].elements[0].link).toBe(couch.link);
  });

  it("keeps a newer board link for review without treating the whole page as synced", () => {
    const item = layer("couch", "https://example.com/original");
    const baseline = {
      version: 1 as const, title: "Living Room", roomId: "living",
      hidden: false, roomApprovalStatus: null, materialImages: [item],
    };
    const state = { pages: [{
      id: "page", roomId: "living", elements: [{ ...asImage(item), link: "https://example.com/board-alternative" }],
      materialsSyncSnapshot: baseline, materialsSyncFingerprint: boardMaterialsFingerprint(baseline),
    }] };
    expect(planMaterialBoardLink(state, "project", material("couch"), item.link!, "https://example.com/spec-link"))
      .toEqual({ board: state, changed: 0, conflicts: 1 });
  });

  it("does not replay saved quantity, notes, or catalog fields on unrelated edits", () => {
    const before = layer("couch", "https://example.com/couch");
    const after = { ...before, src: "https://images.example/couch-new.jpg" };
    const { changes } = planBoardMaterialLayer(before, after, "living", "living", true);
    const patch = boardMaterialFieldsForChanges({
      product_id: "existing-product", image_url: after.src, notes: "Old note",
      product_url: before.link, quantity: 1, cad_label: null, ordered: false,
    }, changes, false);
    expect(patch).toEqual({ image_url: after.src });
    expect(planBoardMaterialLayer(undefined, before, null, "living", true).send).toBe(false);
  });
});
