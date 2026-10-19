import { expect, it } from "vitest";
import {
  roomDesignTileFields,
  roomDesignTileIssues,
  roomDesignTileSurface,
  updateRoomDesignTileNotes,
} from "@/lib/roomDesignTile";
import {
  roomDesignSelectionIssues,
  roomDesignOrderReady,
  retainRoomDesignMeasurements,
} from "@/lib/roomDesignReview";
import {
  createDefaultRoomDesignWorkflowState,
  normalizeRoomDesignWorkflowState,
  mergeRoomDesignSelectionsIntoBoard,
  type RoomDesignSelection,
} from "@/lib/roomDesignWorkflow";
import { tileDetailConfirmed } from "@/lib/tileInstallation";

function selected(notes = ""): RoomDesignSelection {
  return {
    id: "link-shower-wall-tile",
    category: "Shower wall tile",
    productName: "Zagora ceramic tile",
    vendor: "Bedrosians",
    finish: "Blanc",
    source: "Product link",
    state: "locked",
    swatch: "",
    url: "https://example.com/tile",
    imageUrl: "https://example.com/tile.png",
    quantity: 24,
    quantityUnit: "sq ft",
    notes,
    sku: "123",
    price: "$12.00",
    scrapeStatus: "complete",
  };
}
function installationNotes() {
  let notes = "Keep the niche trim.\nInstallation source: Primary bath drawing ID2.8.";
  notes = updateRoomDesignTileNotes(notes, "groutColor", "MAPEI Avalanche");
  notes = updateRoomDesignTileNotes(notes, "jointWidth", "3/16 inch");
  return updateRoomDesignTileNotes(notes, "layout", "Vertical broken joint");
}

it("requires installation choices before a tiled selection can be reviewed or order-ready", () => {
  expect(roomDesignSelectionIssues(selected())).toEqual([
    "Enter the grout color and joint width.",
    "Enter the tile layout / pattern or approved drawing reference.",
    "Enter the tile lay direction or approved drawing reference.",
  ]);
  expect(roomDesignOrderReady(selected())).toBe(false);
  expect(roomDesignSelectionIssues(selected(installationNotes()))).toEqual([]);
  expect(roomDesignOrderReady(selected(installationNotes()))).toBe(true);
  expect(
    roomDesignTileIssues(
      selected(updateRoomDesignTileNotes(installationNotes(), "jointWidth", "1.5 mm")),
    ),
  ).toEqual([]);
});

it("requires both a pattern and a direction, with explicit TBD taking precedence over an older combined layout", () => {
  const patternOnly = updateRoomDesignTileNotes(installationNotes(), "layout", "Running bond");
  expect(roomDesignTileIssues(selected(patternOnly))).toContain(
    "Enter the tile lay direction or approved drawing reference.",
  );
  expect(
    roomDesignTileIssues(
      selected(updateRoomDesignTileNotes(patternOnly, "direction", "Parallel to the hallway")),
    ),
  ).toEqual([]);
  const pendingDirection = updateRoomDesignTileNotes(installationNotes(), "direction", "TBD");
  expect(roomDesignTileIssues(selected(pendingDirection))).toContain(
    "Enter the tile lay direction or approved drawing reference.",
  );
  expect(tileDetailConfirmed("tile_layout", pendingDirection)).toBe(false);
  const explicit = updateRoomDesignTileNotes(patternOnly, "direction", "Horizontal");
  expect(roomDesignTileFields(explicit).direction).toBe("Horizontal");
  expect(roomDesignTileIssues(selected(explicit))).toEqual([]);
});

it("keeps surface-specific installation areas without requiring the same location twice", () => {
  expect(roomDesignTileIssues({ ...selected(installationNotes()), category: "Tile" })).toContain(
    "Confirm where this tile is used.",
  );
  const notes = updateRoomDesignTileNotes(
    installationNotes(),
    "location",
    "Shower walls and niche",
  );
  expect(roomDesignTileIssues({ ...selected(notes), category: "Tile" })).toEqual([]);
  expect(
    roomDesignTileIssues(selected(updateRoomDesignTileNotes(notes, "location", "TBD"))),
  ).toContain("Confirm where this tile is used.");
  expect(roomDesignTileIssues(selected(installationNotes()))).toEqual([]);
});

it("does not treat TBD grout or manufacturer alone as a confirmed choice", () => {
  for (const grout of ["MAPEI", "TBD", "Not applicable"]) {
    const notes = updateRoomDesignTileNotes(
      `Existing off-white grout, 1/8 inch joints.\n${installationNotes()}`,
      "groutColor",
      grout,
    );
    expect(roomDesignTileIssues(selected(notes))).toContain(
      "Enter the grout color and joint width.",
    );
  }
});
it("distinguishes unclassified flooring/backsplashes from known wood, slab and actual tile", () => {
  expect(roomDesignTileSurface({ category: "Flooring" })).toBe("unknown");
  expect(
    roomDesignTileSurface({
      category: "Backsplash",
      notes: "Installation surface: Other material",
    }),
  ).toBe("other");
  expect(
    roomDesignTileSurface({
      category: "Backsplash",
      productName: "Porcelain tile",
      notes: "Installation surface: Other material",
    }),
  ).toBe("tile");
  for (const productName of [
    "Engineered wood flooring",
    "Quartz slab backsplash",
    "Ceramic pendant",
    "3D wooden panels",
  ]) {
    expect(roomDesignTileIssues({ category: "Flooring", productName }), productName).toEqual([]);
  }
  expect(roomDesignTileIssues({ category: "Sink", productName: "Ceramic sink" })).toEqual([]);
});
it("keeps unknown grout or layout decisions flagged, including manufacturer-only grout without a joint width", () => {
  for (const value of ["TBD", "Unknown", "Not sure", "N/A", "None"]) {
    expect(
      roomDesignTileIssues(
        selected(updateRoomDesignTileNotes(installationNotes(), "groutColor", value)),
      ),
    ).toContain("Enter the grout color and joint width.");
  }
  expect(
    roomDesignTileIssues(
      selected(updateRoomDesignTileNotes(installationNotes(), "jointWidth", "")),
    ),
  ).toContain("Enter the grout color and joint width.");
  expect(
    roomDesignTileIssues(
      selected(updateRoomDesignTileNotes(installationNotes(), "layout", "TBD: stacked or offset")),
    ),
  ).toContain("Enter the tile layout / pattern or approved drawing reference.");
});
it("preserves existing approved installation notes and explicit groutless details", () => {
  expect(
    roomDesignTileIssues(
      selected("Grout: Off-white, 1/8 inch joints. Tile layout as shown in drawing ID2.8."),
    ),
  ).toEqual([]);
  expect(
    roomDesignTileIssues(selected("No grout required. Tile layout: Vertical straight set.")),
  ).toEqual([]);
  expect(
    updateRoomDesignTileNotes(installationNotes(), "layout", "Horizontal running bond"),
  ).toContain("Keep the niche trim.");
  expect(
    roomDesignTileFields(
      updateRoomDesignTileNotes(installationNotes(), "layout", "Horizontal running bond"),
    ).layout,
  ).toBe("Horizontal running bond");
  // Controlled fields must keep the separating space while the designer types.
  expect(roomDesignTileFields(updateRoomDesignTileNotes("", "layout", "Vertical ")).layout).toBe(
    "Vertical ",
  );
  expect(
    roomDesignTileFields(updateRoomDesignTileNotes("", "groutColor", "MAPEI ")).groutColor,
  ).toBe("MAPEI ");
  const legacy =
    "Keep trim.\nGrout: MAPEI Avalanche, 3/16 inch joints.\nTile layout: Vertical straight set";
  expect(roomDesignTileFields(legacy).groutColor).toBe("MAPEI Avalanche");
  const updated = updateRoomDesignTileNotes(legacy, "jointWidth", "TBD");
  expect(updated).toContain("Keep trim.");
  expect(updated).not.toContain("3/16");
  expect(roomDesignTileIssues(selected(updated))).toContain(
    "Enter the grout color and joint width.",
  );
});
it("retains project installation decisions through saving, board creation, and the Materials/Spec checker", () => {
  const base = createDefaultRoomDesignWorkflowState("Primary Bathroom");
  const notes = installationNotes();
  const state = normalizeRoomDesignWorkflowState(
    { ...base, links: [{ ...base.links[0], notes }], selections: [selected(notes)] },
    base,
  );
  expect(state.links[0].notes).toBe(notes);
  const board = mergeRoomDesignSelectionsIntoBoard({
    boardState: null,
    projectName: "Test",
    roomId: "bath",
    roomName: "Primary Bathroom",
    selections: state.selections,
    pageCount: 1,
  });
  const image = board.pages.flatMap((p) => p.elements).find((e) => e.type === "image")!;
  expect(image.notes).toBe(notes);
  expect(tileDetailConfirmed("grout", String(image.notes))).toBe(true);
  expect(tileDetailConfirmed("tile_layout", String(image.notes))).toBe(true);
  const refreshed = retainRoomDesignMeasurements(
    { ...selected(), notes: undefined },
    selected(notes),
  );
  expect(refreshed.notes).toBe(notes);
});
