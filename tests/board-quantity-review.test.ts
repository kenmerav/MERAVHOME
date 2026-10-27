import { describe, expect, it } from "vitest";
import {
  boardMaterialUpdatePatch,
  boardQuantityConflict,
  findBoardMaterialForSend,
  quantityForReview,
} from "../src/lib/boardQuantityReview";
import { readBoardSendMaterials, saveReviewedBoardMaterial } from "../src/lib/boardQuantitySave";
import { boardPageQuantity } from "../src/lib/boardMaterialQuantity";
import { specQuantityDatabasePatch } from "../src/lib/specQuantity";
import type { MaterialItem } from "../src/lib/db";

const item = (patch: Partial<MaterialItem> = {}) =>
  ({
    id: "pendant",
    project_id: "project",
    room_id: "kitchen",
    item_label: "Pendants",
    quantity: 4,
    quantity_tbd: false,
    quantity_unit: "count",
    selection_quantity_unit: "count",
    waste_percent: 0,
    updated_at: "version-1",
    color: "Bronze",
    product_url: "https://store.example/pendant",
    product: { dimensions: "20 in" },
    ...patch,
  }) as MaterialItem;
const proposed = {
  quantity: 1,
  quantity_tbd: false,
  quantity_unit: "count",
  waste_percent: 0,
} as const;

function store(initial = item()) {
  const state = {
    row: structuredClone(initial),
    writes: [] as Record<string, unknown>[],
    race: false,
    error: null as unknown,
  };
  const client = {
    from: (table: string) => {
      expect(table).toBe("material_items");
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | undefined;
      const query = {
        select: (_: string) => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        order: (_: string) => query,
        range: async () => ({ data: [structuredClone(state.row)], error: state.error }),
        update: (value: Record<string, unknown>) => {
          patch = value;
          return query;
        },
        single: async () => ({ data: structuredClone(state.row), error: state.error }),
        maybeSingle: async () => {
          if (state.race) state.row.updated_at = "version-2";
          if (state.error) return { data: null, error: state.error };
          if (
            Object.entries(filters).some(
              ([key, value]) => state.row[key as keyof MaterialItem] !== value,
            )
          )
            return { data: null, error: null };
          state.writes.push(patch!);
          Object.assign(state.row, patch, { updated_at: "version-2" });
          return { data: structuredClone(state.row), error: null };
        },
      };
      return query;
    },
  };
  return { state, client: client as never };
}

describe("quantity review before board sends", () => {
  it("shows corrected Spec Book 4 versus board 1 and preserves every quantity field by default", async () => {
    const { state, client } = store();
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    expect(conflict.spec.quantity).toBe(4);
    expect(conflict.board.quantity).toBe(1);
    await saveReviewedBoardMaterial(
      client,
      "project",
      "pendant",
      { ...specQuantityDatabasePatch(proposed), notes: "Board note" },
      proposed,
      { [conflict.key]: "keep" },
    );
    expect(state.row.quantity).toBe(4);
    expect(state.row.notes).toBe("Board note");
    for (const key of [
      "quantity",
      "quantity_tbd",
      "quantity_unit",
      "selection_quantity_unit",
      "waste_percent",
    ])
      expect(state.writes[0]).not.toHaveProperty(key);
  });
  it("replaces only an explicitly approved item with the exact reviewed board quantity", async () => {
    const { state, client } = store();
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    await saveReviewedBoardMaterial(
      client,
      "project",
      "pendant",
      { ...specQuantityDatabasePatch(proposed), quantity: 999 },
      proposed,
      { [conflict.key]: "board" },
    );
    expect(state.row.quantity).toBe(1);
  });
  it("saves an entered quantity while preserving the reviewed measurement and waste", async () => {
    const { state, client } = store(
      item({
        quantity: 100,
        quantity_unit: "square_feet",
        selection_quantity_unit: "square_feet",
        waste_percent: 15,
      }),
    );
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    await saveReviewedBoardMaterial(
      client,
      "project",
      "pendant",
      { notes: "Board note" },
      proposed,
      {
        [conflict.key]: {
          kind: "custom",
          quantity: {
            quantity: 125.5,
            quantity_tbd: false,
            quantity_unit: "square_feet",
            waste_percent: 15,
          },
        },
      },
    );
    expect(state.row).toMatchObject({
      quantity: 125.5,
      quantity_tbd: false,
      selection_quantity_unit: "square_feet",
      waste_percent: 15,
      notes: "Board note",
    });
  });
  it("accepts a chosen TBD and rejects invalid counts, changed units, and changed waste", async () => {
    const { state, client } = store();
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    for (const quantity of [
      { quantity: 1.5, quantity_tbd: false, quantity_unit: "count", waste_percent: 0 },
      { quantity: null, quantity_tbd: false, quantity_unit: "count", waste_percent: 0 },
      { quantity: 3, quantity_tbd: false, quantity_unit: "square_feet", waste_percent: 0 },
      { quantity: 3, quantity_tbd: false, quantity_unit: "count", waste_percent: 5 },
    ] as const) {
      await expect(
        saveReviewedBoardMaterial(client, "project", "pendant", {}, proposed, {
          [conflict.key]: { kind: "custom", quantity },
        }),
      ).rejects.toThrow();
    }
    expect(state.writes).toHaveLength(0);
    await saveReviewedBoardMaterial(client, "project", "pendant", {}, proposed, {
      [conflict.key]: {
        kind: "custom",
        quantity: { quantity: null, quantity_tbd: true, quantity_unit: "count", waste_percent: 0 },
      },
    });
    expect(state.row).toMatchObject({ quantity: null, quantity_tbd: true });
  });
  it("does not replay a custom choice after the saved quantity or board changes", async () => {
    const { state, client } = store();
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    const decision = {
      [conflict.key]: { kind: "custom" as const, quantity: { ...proposed, quantity: 3 } },
    };
    state.row.quantity = 7;
    await expect(
      saveReviewedBoardMaterial(client, "project", "pendant", {}, proposed, decision),
    ).rejects.toThrow(/changed since review/);
    state.row.quantity = 1; // A concurrent edit can also make the saved value equal the board.
    await expect(
      saveReviewedBoardMaterial(client, "project", "pendant", {}, proposed, decision),
    ).rejects.toThrow(/changed since review/);
    state.row.quantity = 4;
    await expect(
      saveReviewedBoardMaterial(
        client,
        "project",
        "pendant",
        {},
        { ...proposed, quantity: 2 },
        decision,
      ),
    ).rejects.toThrow(/changed since review/);
    expect(state.writes).toHaveLength(0);
  });
  it("uses the actual board item image, product details and target when reviewing an unlabeled selection", () => {
    const conflict = boardQuantityConflict(
      item({ item_label: "Unlabeled Item", image_url: "old.png" }),
      proposed,
      "Bar Room",
      {
        imageUrl: "board.png",
        productName: "Example lamp",
        productUrl: "https://store.example/lamp",
        boardPageId: "page",
        boardElementId: "layer",
      },
    );
    expect(conflict).toMatchObject({
      materialId: "pendant",
      roomId: "kitchen",
      imageUrl: "board.png",
      productName: "Example lamp",
      boardPageId: "page",
      boardElementId: "layer",
    });
    expect(
      boardQuantityConflict(
        item({
          item_label: "Unlabeled Item",
          product: { name: "Known lamp" } as MaterialItem["product"],
        }),
        proposed,
        "Kitchen",
        { productName: "Unlabeled Item" },
      )?.productName,
    ).toBe("Known lamp");
  });
  it("rejects missing approval, a newer Spec Book edit, and a changed board proposal", async () => {
    const { state, client } = store();
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    await expect(
      saveReviewedBoardMaterial(client, "project", "pendant", proposed, proposed, {}),
    ).rejects.toThrow(/changed since review/);
    state.row.quantity = 7;
    await expect(
      saveReviewedBoardMaterial(client, "project", "pendant", proposed, proposed, {
        [conflict.key]: "board",
      }),
    ).rejects.toThrow(/changed since review/);
    state.row.quantity = 4;
    const changedBoard = { ...proposed, quantity: 2 };
    await expect(
      saveReviewedBoardMaterial(client, "project", "pendant", changedBoard, changedBoard, {
        [conflict.key]: "board",
      }),
    ).rejects.toThrow(/changed since review/);
    expect(state.writes).toHaveLength(0);
  });
  it("uses a conditional save so an edit between the final read and update stops the send", async () => {
    const { state, client } = store();
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    state.race = true;
    await expect(
      saveReviewedBoardMaterial(client, "project", "pendant", proposed, proposed, {
        [conflict.key]: "board",
      }),
    ).rejects.toThrow(/changed while sending/);
    expect(state.row.quantity).toBe(4);
    expect(state.writes).toHaveLength(0);
  });
  it("compares measurement, zero, blank, TBD, and waste without converting unknowns to one", () => {
    expect(boardQuantityConflict(item({ quantity: 0 }), proposed, "Kitchen")?.spec.quantity).toBe(
      0,
    );
    expect(
      boardQuantityConflict(item({ quantity: null, quantity_tbd: true }), proposed, "Kitchen")?.spec
        .quantity_tbd,
    ).toBe(true);
    expect(
      boardQuantityConflict(item({ quantity: null, quantity_tbd: false }), proposed, "Kitchen")
        ?.spec.quantity_tbd,
    ).toBe(false);
    expect(
      boardQuantityConflict(
        item({ quantity: 1, selection_quantity_unit: "square_feet", waste_percent: 10 }),
        proposed,
        "Kitchen",
      ),
    ).not.toBeNull();
    expect(
      quantityForReview(item({ quantity_unit: "count", selection_quantity_unit: "box" }))
        .quantity_unit,
    ).toBe("box");
    expect(boardQuantityConflict(item({ quantity: 1 }), proposed, "Kitchen")).toBeNull();
  });
  it("preserves square footage, waste, and TBD when keeping Spec Book values", async () => {
    const { state, client } = store(
      item({
        quantity: null,
        quantity_tbd: true,
        selection_quantity_unit: "square_feet",
        waste_percent: 15,
      }),
    );
    const conflict = boardQuantityConflict(state.row, proposed, "Kitchen")!;
    await saveReviewedBoardMaterial(
      client,
      "project",
      "pendant",
      specQuantityDatabasePatch(proposed),
      proposed,
      { [conflict.key]: "keep" },
    );
    expect(state.row).toMatchObject({
      quantity: null,
      quantity_tbd: true,
      selection_quantity_unit: "square_feet",
      waste_percent: 15,
    });
  });
  it("does not replay even equal quantity fields without an explicit replacement", async () => {
    const { state, client } = store(item({ quantity: 1 }));
    await saveReviewedBoardMaterial(client, "project", "pendant", proposed, proposed, {});
    expect(state.writes[0]).not.toHaveProperty("quantity");
    expect(boardMaterialUpdatePatch({ quantity: 1, notes: "Keep other changes" }, false)).toEqual({
      notes: "Keep other changes",
    });
  });
  it("never matches a stale reference to another item, room, or variant", () => {
    const target = {
      roomId: "kitchen",
      materialItemId: "stale",
      label: "Pendants",
      productUrl: "https://store.example/pendant/",
      color: "bronze",
      dimensions: "20 in",
    };
    expect(
      findBoardMaterialForSend(target, [item({ id: "stale", item_label: "Sink" }), item()])?.id,
    ).toBe("pendant");
    expect(findBoardMaterialForSend({ ...target, roomId: "bath" }, [item()])).toBeNull();
    expect(findBoardMaterialForSend({ ...target, color: "Black" }, [item()])).toBeNull();
    expect(
      findBoardMaterialForSend(
        { ...target, materialItemId: "pendant", productUrl: "", materialLinkCleared: true },
        [item()],
      )?.id,
    ).toBe("pendant");
  });
  it("reviews the existing room quantity against the total on a page without summing references across rooms", () => {
    const boardQuantity = boardPageQuantity([
      { id: "a", materialQuantity: 1 },
      { id: "b", materialQuantity: 1 },
    ]);
    expect(
      boardQuantityConflict(item(), { ...proposed, quantity: boardQuantity }, "Kitchen")?.board
        .quantity,
    ).toBe(2);
  });
  it("fails closed when the current project materials cannot be read", async () => {
    const { state, client } = store();
    state.error = new Error("Network unavailable");
    await expect(readBoardSendMaterials(client, "project")).rejects.toThrow(/Network unavailable/);
    expect(state.writes).toHaveLength(0);
  });
});
