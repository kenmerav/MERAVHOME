import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseSelectionSheet,
  selectionImportMarker,
  SOURCE_ROOM_TARGET,
} from "../src/lib/selectionSheetImport";

const mock = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; action: string; payload: Record<string, unknown> }>,
  errorTable: "",
  failInsert: "",
  sequence: 0,
}));

vi.mock("../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let action = "read",
        payload: Record<string, unknown> = {},
        single = false;
      const filters: Array<[string, unknown]> = [];
      const execute = () => {
        if (mock.errorTable === table || (mock.failInsert === table && action === "insert"))
          return { data: null, error: new Error("Database rejected write") };
        const records = mock.tables[table] ?? [];
        const matching = records.filter((record) =>
          filters.every(([field, value]) => record[field] === value),
        );
        if (action === "insert") {
          const record = { id: `new-${++mock.sequence}`, ...payload };
          records.push(record);
          mock.writes.push({ table, action, payload });
          return { data: single ? record : [record], error: null };
        }
        if (action === "update") {
          matching.forEach((record) => Object.assign(record, payload));
          mock.writes.push({ table, action, payload });
        }
        return { data: single ? (matching[0] ?? null) : matching, error: null };
      };
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          filters.push([field, value]);
          return query;
        },
        insert: (value: Record<string, unknown>) => {
          action = "insert";
          payload = value;
          return query;
        },
        update: (value: Record<string, unknown>) => {
          action = "update";
          payload = value;
          return query;
        },
        single: () => {
          single = true;
          return Promise.resolve(execute());
        },
        maybeSingle: () => {
          single = true;
          return Promise.resolve(execute());
        },
        then: (resolve: (result: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  },
}));

import { importSelectionSheet } from "../src/lib/selectionSheetImportClient";

const row = () =>
  parseSelectionSheet(
    "ID,Room,Item,Product,Vendor,Finish,Dimensions,Quantity,Product link,Status\nSEL-001,Bath,Flooring,Cream Misto,TileBar,Honed,6 x 12,,,Selected; details open",
  )[0];

beforeEach(() => {
  mock.tables = {
    rooms: [
      { id: "bath", project_id: "project", name: "Bath" },
      { id: "other", project_id: "other-project", name: "Other" },
    ],
    material_items: [],
    products: [],
  };
  mock.writes = [];
  mock.errorTable = "";
  mock.failInsert = "";
  mock.sequence = 0;
});

describe("selection import persistence", () => {
  it.skipIf(!process.env.SELECTION_IMPORT_CSV)(
    "imports the prepared 51-entry sheet and retries without duplicates",
    async () => {
      const rows = parseSelectionSheet(readFileSync(process.env.SELECTION_IMPORT_CSV!, "utf8"));
      expect(rows).toHaveLength(51);
      expect(rows.filter((row) => !row.productUrl)).toHaveLength(33);
      const mapping = Object.fromEntries(rows.map((row) => [row.room, [SOURCE_ROOM_TARGET]]));
      const first = await importSelectionSheet("project", rows, mapping, vi.fn());
      expect(first.saved).toBe(51);
      const retry = await importSelectionSheet("project", rows, mapping, vi.fn());
      expect(retry).toEqual({ saved: 51, created: 0, updated: 51 });
      expect(mock.tables.material_items).toHaveLength(51);
      expect(mock.tables.products).toHaveLength(51);
      for (const row of rows) {
        const item = mock.tables.material_items.find((item) =>
          String(item.notes).split("\n").includes(selectionImportMarker("project", row.sourceId)),
        );
        expect(item).toBeDefined();
        expect(item!.quantity).toBe(row.quantity);
        expect(item!.product_url).toBe(row.productUrl);
        expect(mock.tables.rooms.find((room) => room.id === item!.room_id)?.name).toBe(row.room);
      }
    },
  );
  it("keeps a missing source room name and reuses it on retry", async () => {
    const selection = { ...row(), room: "Office powder" };
    const mapping = { "Office powder": [SOURCE_ROOM_TARGET] };
    await importSelectionSheet("project", [selection], mapping, vi.fn());
    await importSelectionSheet("project", [selection], mapping, vi.fn());
    const createdRooms = mock.tables.rooms.filter((room) => room.name === "Office powder");
    expect(createdRooms).toHaveLength(1);
    expect(mock.tables.material_items).toHaveLength(1);
    expect(mock.tables.material_items[0].room_id).toBe(createdRooms[0].id);
    expect(mock.tables.products[0].product_url).toBeNull();
  });
  it("reuses an existing room when its source name matches without creating another", async () => {
    await importSelectionSheet("project", [row()], { Bath: [SOURCE_ROOM_TARGET] }, vi.fn());
    expect(mock.writes.filter((write) => write.table === "rooms")).toHaveLength(0);
    expect(mock.tables.material_items[0].room_id).toBe("bath");
  });
  it("checks all room assignments before creating a missing source room", async () => {
    await expect(
      importSelectionSheet(
        "project",
        [
          { ...row(), room: "Zen room" },
          { ...row(), sourceId: "SEL-002", room: "Bad mapping" },
        ],
        { "Zen room": [SOURCE_ROOM_TARGET], "Bad mapping": ["other"] },
        vi.fn(),
      ),
    ).rejects.toThrow("not in this project");
    expect(mock.writes).toHaveLength(0);
  });
  it("does not duplicate a stated total across multiple assigned rooms", async () => {
    mock.tables.rooms.push({ id: "second", project_id: "project", name: "Second bath" });
    await expect(
      importSelectionSheet(
        "project",
        [{ ...row(), quantity: 2 }],
        { Bath: ["bath", "second"] },
        vi.fn(),
      ),
    ).rejects.toThrow("counted twice");
    expect(mock.writes).toHaveLength(0);
  });
  it("creates a catalog-linked spec entry with genuinely blank missing fields", async () => {
    const result = await importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn());
    expect(result).toEqual({ created: 1, updated: 0, saved: 1 });
    expect(mock.tables.products[0]).toMatchObject({
      name: "Cream Misto",
      product_url: null,
      image_url: null,
    });
    expect(mock.tables.material_items[0]).toMatchObject({
      product_id: mock.tables.products[0].id,
      quantity: null,
      product_url: null,
    });
    expect(mock.writes.some((write) => write.action === "delete")).toBe(false);
  });
  it("retries without duplicating catalog products or spec entries", async () => {
    await importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn());
    await importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn());
    expect(mock.tables.products).toHaveLength(1);
    expect(mock.tables.material_items).toHaveLength(1);
    expect(mock.tables.material_items[0].notes).toContain(
      selectionImportMarker("project", "SEL-001"),
    );
  });
  it("validates rooms and ambiguous matches before any writes", async () => {
    await expect(
      importSelectionSheet("project", [row()], { Bath: ["other"] }, vi.fn()),
    ).rejects.toThrow("not in this project");
    expect(mock.writes).toHaveLength(0);
    mock.tables.material_items = ["a", "b"].map((id) => ({
      id,
      room_id: "bath",
      project_id: "project",
      item_label: "Flooring",
    }));
    await expect(
      importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn()),
    ).rejects.toThrow("Multiple empty");
    expect(mock.writes).toHaveLength(0);
  });
  it("preserves catalog identity, manual notes, an exclusion and a known zero quantity", async () => {
    mock.tables.material_items = [
      {
        id: "selected",
        project_id: "project",
        room_id: "bath",
        item_label: "Flooring",
        product_id: "kept",
        quantity: 0,
        not_needed: true,
        color: "Existing finish",
        notes: "Manual note\n" + selectionImportMarker("project", "SEL-001"),
      },
    ];
    await importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn());
    expect(mock.tables.products).toHaveLength(0);
    expect(mock.tables.material_items[0]).toMatchObject({
      product_id: "kept",
      quantity: 0,
      not_needed: true,
      color: "Existing finish",
    });
    expect(mock.tables.material_items[0].notes).toContain("Manual note");
  });
  it("stops on database errors and resumes after a partially completed import", async () => {
    mock.errorTable = "material_items";
    await expect(
      importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn()),
    ).rejects.toThrow("rejected");
    expect(mock.writes).toHaveLength(0);
    mock.errorTable = "";
    mock.failInsert = "material_items";
    await expect(
      importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn()),
    ).rejects.toThrow("rejected");
    expect(mock.tables.products).toHaveLength(1);
    mock.failInsert = "";
    await importSelectionSheet("project", [row()], { Bath: ["bath"] }, vi.fn());
    expect(mock.tables.products).toHaveLength(1);
    expect(mock.tables.material_items).toHaveLength(1);
  });
});
