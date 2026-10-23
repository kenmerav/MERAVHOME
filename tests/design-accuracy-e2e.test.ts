import { describe, expect, it } from "vitest";
import {
  applyAccuracyCommand,
  accuracyOutputs,
  accuracyProgress,
  createAccuracyState,
  snapshotChanged,
  type AccuracyCommand,
  type AccuracySource,
  type AccuracyState,
} from "../src/lib/designAccuracy";
import { accuracyHandoff, accuracyInvoiceTerms } from "../src/lib/designAccuracyProjection";
import { buildSpecSpreadsheetRows } from "../src/lib/specBookRows";
import type { MaterialItem } from "../src/lib/db";

describe("kitchen and bathroom design-to-spec local fixture", () => {
  it("resolves full scope, confirms actual choices, coordinates one cited requirement and preserves issued history", () => {
    const actor = "test-designer",
      at = "2026-10-23T18:00:00Z";
    const brief: AccuracySource = {
      id: "brief",
      kind: "brief",
      label: "Approved kitchen and bathroom design",
      revision: "R1",
      reference: "Design brief D-12: explicitly approved room requirements and named selections",
    };
    const plan: AccuracySource = {
      id: "plan",
      kind: "document",
      documentId: "plan-file",
      label: "Bathroom elevation",
      revision: "R1",
      reference: "Two vanity faucet callouts at basin A and basin B",
      sheet: "A-201",
      page: 3,
    };
    let state = createAccuracyState(
      "local-e2e",
      [
        { id: "k", name: "Kitchen" },
        { id: "b", name: "Primary Bathroom" },
      ],
      actor,
      at,
    );
    const run = (...commands: AccuracyCommand[]) => {
      state = commands.reduce((s, command) => applyAccuracyCommand(s, command, actor, at), state);
    };
    const selected = new Set(["k:cabinet-finish", "k:faucet", "b:faucet-s", "b:flooring"]);
    run({
      type: "scope",
      rooms: [
        { id: "k", name: "Kitchen" },
        { id: "b", name: "Primary Bathroom" },
      ],
      source: brief,
    });
    // These are explicit fixture design decisions, not inferred omissions from a drawing.
    for (const room of state.rooms)
      for (const item of room.items)
        run({
          type: "decision",
          roomId: room.id,
          itemId: item.id,
          disposition: selected.has(item.id) ? "select" : "not-needed",
        });
    const confirm = (roomId: string, itemId: string, fields: Record<string, string | number>) => {
      run(
        ...Object.entries(fields).map(([key, value]) => ({
          type: "field" as const,
          roomId,
          itemId,
          key,
          value,
        })),
      );
      run({ type: "confirm", roomId, itemId, keys: Object.keys(fields), source: brief });
    };
    confirm("k", "k:cabinet-finish", {
      manufacturer: "Cabinet maker",
      color: "Natural oak",
      finishCodeOrSample: "Approved sample K-04",
      location: "Perimeter",
    });
    const faucet = {
      productName: "Bridge faucet",
      manufacturer: "Fixture maker",
      sku: "BR-01",
      color: "Bronze",
      imageUrl: "https://example.com/faucet.jpg",
      url: "https://example.com/faucet?variant=bronze",
      quantity: 1,
      quantityUnit: "each",
      quantityBasis: "Kitchen island layout K-2: one sink faucet",
      location: "Island",
    };
    confirm("k", "k:faucet", faucet);
    confirm("b", "b:faucet-s", {
      ...faucet,
      color: "Black with brass accents",
      sku: "BR-02",
      quantity: 2,
      quantityBasis: "Bath elevation A-201: basin A and basin B",
      location: "Double vanity",
      url: "https://example.com/faucet?variant=black-brass",
    });
    confirm("b", "b:flooring", {
      productName: "Porcelain tile",
      manufacturer: "Tile maker",
      sku: "T-01",
      color: "Ivory",
      imageUrl: "https://example.com/tile.jpg",
      url: "https://example.com/tile?variant=ivory",
      quantity: 103,
      quantityUnit: "sq ft",
      quantityBasis: "Approved tile layout T-1: 103 sq ft net coverage",
      location: "Bathroom floor",
      grout: "Warm gray G-03",
      joint: "1/8 inch",
      layout: "Running bond",
      direction: "Along vanity wall",
      edge: "Matching stone threshold",
      fieldRequired: "no",
      purchaseUnit: "box",
      packCoverage: 12,
      coverageUnit: "sq ft",
      wastePercent: 10,
      sellingIncrement: 1,
      price: 80,
      priceUnit: "box",
    });
    expect(accuracyProgress(state).designComplete).toBe(true);
    expect(accuracyProgress(state).drawing).toBe("pending");
    run(
      { type: "source", source: plan },
      {
        type: "check",
        check: {
          id: "bath-count",
          roomId: "b",
          itemId: "b:faucet-s",
          field: "quantity",
          expected: 2,
          relation: "equals",
          source: plan,
          mode: "manual",
        },
      },
      {
        type: "coverage",
        coverage: {
          sourceId: plan.id,
          revision: plan.revision,
          expected: ["A-201:p3:faucet-count"],
          processed: ["A-201:p3:faucet-count"],
          failed: [],
          cancelled: false,
        },
      },
    );
    expect(accuracyProgress(state).drawing).toBe("checked-requirements-only");
    run({ type: "snapshot", id: "issued-1", kind: "design-approved" });
    const reloaded: AccuracyState = JSON.parse(JSON.stringify(state));
    expect(accuracyHandoff(reloaded, "board").rows).toEqual(accuracyHandoff(reloaded, "spec").rows);
    expect(accuracyHandoff(reloaded, "spec").rows).toEqual(
      accuracyHandoff(reloaded, "drawing-handoff").rows,
    );
    const tile = accuracyOutputs(reloaded).find((row) => row.sourceId === "b:flooring")!;
    expect(accuracyInvoiceTerms(tile)).toMatchObject({
      quantity: "10",
      quantityUnit: "box",
      unitPrice: "80",
      selected: true,
    });
    expect(accuracyInvoiceTerms({ ...tile, priceUnit: "sq ft" })).toMatchObject({
      quantity: "TBD",
      selected: false,
    });
    const spec = buildSpecSpreadsheetRows(
      [
        {
          id: "material-tile",
          project_id: state.projectId,
          room_id: "b",
          item_label: "Floor tile",
          category: "Tile & Stone",
          not_needed: false,
          quantity: 103,
          quantity_unit: "square_feet",
          design_accuracy_fact: tile,
        } as MaterialItem,
      ],
      [{ id: "b", name: "Primary Bathroom" }],
    );
    expect(spec[0]).toMatchObject({
      quantity: "103",
      quantityUnit: "square_feet",
      orderQuantity: "10 box",
      clientPrice: "$80.00 / box",
      color: "Ivory",
      sku: "T-01",
    });
    run({
      type: "source",
      source: {
        ...plan,
        revision: "R2",
        reference: "Revised bathroom elevation requires rechecking faucet callouts",
      },
    });
    expect(accuracyProgress(state).designComplete).toBe(false);
    expect(accuracyProgress(state, "k").designComplete).toBe(true);
    expect(accuracyProgress(state, "b").designComplete).toBe(false);
    expect(snapshotChanged(state, state.snapshots[0])).toBe(true);
    expect(state.snapshots[0].checks?.[0].source.revision).toBe("R1");
    expect(() => run({ type: "snapshot", id: "forged-approval", kind: "design-approved" })).toThrow(
      /Unresolved/,
    );
  });
});
