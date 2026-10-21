import { expect, it } from "vitest";
import { selectionItemsForRoom } from "@/lib/selectionChecklist";
import {
  createDefaultRoomDesignWorkflowState,
  normalizeRoomDesignWorkflowState,
  reconcileRoomDesignChecklist,
  mergeRoomDesignSelectionsIntoBoard,
  type RoomDesignSelection,
} from "@/lib/roomDesignWorkflow";
import {
  roomDetailValue,
  updateRoomDetail,
  roomItemDetailFields,
  roomItemStatus,
  roomItemNeedsProduct,
  roomScopeValue,
  updateRoomScope,
  synchronizeRoomSelectionDetails,
  roomDecisionIssues,
  roomProjectDefaults,
  markRoomRelatedChanges,
  roomDesignScrapedNotes,
  roomRelatedFitReview,
  roomItemSummaryNotes,
} from "@/lib/roomDesignDetails";
import { roomDesignOrderReady, roomDesignSelectionIssues } from "@/lib/roomDesignReview";
import { mergeRoomDesignEdits } from "@/lib/roomDesignSync";
import { roomDesignTileIssues, updateRoomDesignTileNotes } from "@/lib/roomDesignTile";

it("provides specific room templates while keeping powder bathrooms shower-free", () => {
  for (const room of ["Bathroom 2", "Hall Bathroom", "Guest Bath", "Raegan Bathroom"]) {
    const labels = selectionItemsForRoom(room).map((item) => item.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Sink(s)",
        "Toilet",
        "Shower glass / enclosure",
        "Shower rough-in valve",
        "Towel bar",
        "Exhaust fan",
      ]),
    );
    expect(labels.some((label) => /sink drain/i.test(label))).toBe(false);
  }
  expect(selectionItemsForRoom("Powder Room").some((item) => /shower/i.test(item.label))).toBe(
    false,
  );
  expect(selectionItemsForRoom("Laundry Room").map((item) => item.label)).toContain("Dryer");
  expect(selectionItemsForRoom("Mud Room").map((item) => item.label)).toContain("Bench");
  expect(selectionItemsForRoom("Fireplace").map((item) => item.label)).toContain("Mantel");
  expect(selectionItemsForRoom("Project-wide finishes").map((item) => item.label)).toContain(
    "Baseboard",
  );
});

it("starts new measured quantities at TBD without resetting existing quantities or notes", () => {
  const state = createDefaultRoomDesignWorkflowState("Primary Bathroom");
  expect(state.links.find((link) => link.category === "Flooring")?.quantity).toBeNull();
  expect(state.links.find((link) => link.category === "Toilet")?.quantity).toBe(1);
  const older = {
    ...state,
    links: state.links
      .filter((link) => !/shower glass/i.test(link.category))
      .map((link) =>
        link.category === "Flooring" ? { ...link, quantity: 73, notes: "Keep this choice" } : link,
      ),
  };
  const upgraded = reconcileRoomDesignChecklist(older, "Primary Bathroom");
  expect(upgraded.links.find((link) => link.category === "Flooring")).toMatchObject({
    quantity: 73,
    notes: "Keep this choice",
  });
  expect(upgraded.links.map((link) => link.category)).toContain("Shower glass / enclosure");
  expect(reconcileRoomDesignChecklist(upgraded, "Primary Bathroom").links).toEqual(upgraded.links);
});

it("keeps the tile decisions and freeform notes when editing other details, including URL colons", () => {
  const original =
    "Keep this selection.\nGrout color: MAPEI Avalanche\nTile lay direction: Vertical";
  let notes = updateRoomDetail(
    original,
    "Reference drawing / image",
    "https://example.com/drawing#page=2",
  );
  notes = updateRoomDetail(notes, "Edge profile", "Eased");
  notes = updateRoomDetail(notes, "Edge profile", "Mitered");
  expect(notes).toContain(original);
  expect(roomDetailValue(notes, "Reference drawing / image")).toBe(
    "https://example.com/drawing#page=2",
  );
  expect(notes.match(/Edge profile:/g)).toHaveLength(1);
  expect(roomDetailValue(updateRoomDetail(notes, "Edge profile", ""), "Edge profile")).toBe("");
});

it("offers only relevant installation prompts", () => {
  const fields = (category: string) => roomItemDetailFields(category).map((field) => field.label);
  expect(fields("Countertop")).toEqual(
    expect.arrayContaining(["Material thickness", "Edge profile", "Overhang"]),
  );
  expect(fields("Vanity construction + door style")).toContain("Cabinet configuration");
  expect(fields("Island pendants")).toEqual([]);
  expect(fields("Faucet")).toEqual([]);
  expect(fields("Shower niche")).not.toContain("Glass height");
  expect(fields("Shower glass / enclosure")).toContain("Glass / door swing");
  expect(fields("Wall finish")).toContain("Paint sheen");
  expect(fields("Refrigerator")).toContain("Panel requirements");
  expect(fields("Under-cabinet lighting")).toEqual([]);
  expect(fields("Countertop power")).not.toContain("Edge profile");
  expect(fields("Exhaust fan")).not.toContain("Light temperature / controls");
});

it("keeps paint and countertop entry small without losing saved product choices", () => {
  const labels = (category: string) => roomItemDetailFields(category).map((field) => field.label);
  expect(labels("Wall finish")).toEqual(["Paint sheen", "Additional instructions"]);
  expect(labels("Ceiling finish")).toEqual(["Paint sheen", "Additional instructions"]);
  expect(labels("Countertop")).toEqual([
    "Material thickness",
    "Edge profile",
    "Overhang",
    "Additional instructions",
  ]);
  for (const category of ["Wall finish", "Countertop", "Faucet", "Island pendants"]) {
    expect(labels(category)).not.toContain("Selected size / dimensions");
    expect(labels(category)).not.toContain("Selected color / finish");
  }
  const state = createDefaultRoomDesignWorkflowState("Kitchen");
  state.links[0].notes =
    "Paint brand: Benjamin Moore\nPaint color / code: White Dove\nCoverage start / stop: Keep this saved note";
  expect(normalizeRoomDesignWorkflowState(state, state).links[0].notes).toBe(state.links[0].notes);
});

it("omits extra details for straightforward door and ceiling fixture selections", () => {
  for (const category of ["Door hardware", "Decorative ceiling lighting", "Doors", "Exhaust fan"]) {
    expect(roomItemDetailFields(category)).toEqual([]);
    const notes = "Additional instructions: Keep the existing location";
    expect(roomItemDetailFields(category, { notes })).toEqual([]);
    const state = createDefaultRoomDesignWorkflowState("Primary Bathroom");
    state.links[0] = { ...state.links[0], category, notes };
    expect(normalizeRoomDesignWorkflowState(state, state).links[0].notes).toBe(notes);
  }
});

it("does not reopen Notes for sinks, drains, faucets, refrigerators or freezers with saved notes", () => {
  const notes =
    "Additional instructions: Keep existing location\nRelated change review: Recheck fit after Cabinet layout changed.";
  for (const category of [
    "Sink drain",
    "Kitchen sink drain and strainer",
    "Sink",
    "Sink(s)",
    "Kitchen sink",
    "Faucet",
    "Faucet(s)",
    "Kitchen faucet",
    "Fridge",
    "Refrigerator",
    "Freezer",
    "Appliance freezer",
  ]) {
    const fields = roomItemDetailFields(category, { notes });
    expect(
      fields.map((field) => field.label),
      category,
    ).not.toContain("Additional instructions");
    const state = createDefaultRoomDesignWorkflowState("Kitchen");
    state.links[0] = { ...state.links[0], category, notes };
    expect(normalizeRoomDesignWorkflowState(state, state).links[0].notes).toBe(notes);
  }
  expect(roomItemDetailFields("Refrigerator", { notes }).map((field) => field.label)).toEqual([
    "Panel requirements",
  ]);
  expect(roomItemDetailFields("Countertop", { notes }).map((field) => field.label)).toContain(
    "Additional instructions",
  );
});

it("ignores saved faucet fit warnings while retaining real pending selection decisions", () => {
  const notes = "Related change review: Recheck fit after Cabinet layout changed.";
  for (const category of ["Faucet", "Faucet(s)", "Kitchen faucet", "Shower faucet"]) {
    expect(roomRelatedFitReview({ category, notes })).toBe("");
    expect(roomDecisionIssues({ category, notes })).toEqual([]);
    expect(roomItemDetailFields(category, { notes })).toEqual([]);
    expect(
      roomDecisionIssues({ category, notes: `${notes}\nSubstitution status: Awaiting approval` }),
    ).toEqual(["The proposed substitution still needs approval."]);
  }
  expect(roomRelatedFitReview({ category: "Sink", notes })).toContain("Recheck fit");
  expect(roomDecisionIssues({ category: "Sink", notes })).toHaveLength(1);
});

it("omits saved fit warnings for backsplash, countertops and sink drains", () => {
  const notes = "Related change review: Recheck fit after Cabinet layout changed.";
  for (const category of [
    "Backsplash",
    "Kitchen backsplash",
    "Countertop",
    "Island countertop",
    "Counter top",
    "Sink drain",
    "Kitchen sink drain and strainer",
  ]) {
    expect(roomRelatedFitReview({ category, notes }), category).toBe("");
    expect(roomDecisionIssues({ category, notes }), category).toEqual([]);
  }
  expect(roomRelatedFitReview({ category: "Shower drain", notes })).toContain("Recheck fit");
});

it("hides obsolete fit notes under item names while preserving the actual installation notes", () => {
  const fit = "Related change review: Recheck fit after Appliance layout changed.";
  const notes = `Material thickness: 3 cm\n${fit}\nEdge profile: Eased`;
  for (const category of ["Countertop", "Backsplash", "Faucet", "Sink drain"]) {
    expect(roomItemSummaryNotes({ category, notes })).toBe(
      "Material thickness: 3 cm\nEdge profile: Eased",
    );
    expect(roomItemSummaryNotes({ category, notes: fit })).toBe("");
  }
  expect(roomItemSummaryNotes({ category: "Cabinet layout", notes })).toBe(notes);
  expect(roomItemSummaryNotes({ category: "Countertop" })).toBe("");
  expect(notes).toContain(fit);
});

it("removes hardware and dishwasher installation forms without losing saved instructions", () => {
  const notes =
    "Hardware assignment: TBD\nPulls per drawer: Varies by drawer\nPanel requirements: TBD\nAdditional instructions: Keep this saved note";
  for (const category of [
    "Cabinet hardware",
    "Vanity hardware",
    "Kitchen cabinet hardware",
    "Dishwasher",
    "Panel-ready dishwasher",
  ]) {
    expect(roomItemDetailFields(category, { notes }), category).toEqual([]);
    expect(roomDecisionIssues({ category, notes }), category).toEqual([]);
    const state = createDefaultRoomDesignWorkflowState("Kitchen");
    state.links[0] = { ...state.links[0], category, notes };
    expect(normalizeRoomDesignWorkflowState(state, state).links[0].notes).toBe(notes);
  }
});

it("limits fresh detail sections to historical custom-work callouts and tile choices", () => {
  for (const category of [
    "Backsplash",
    "Sink",
    "Toilet",
    "Towel bar",
    "Flooring",
    "Baseboard",
    "Ceiling fan",
    "Wall sconces",
    "Shower system",
    "Shower glass hardware",
    "Countertop power",
    "Stair runner",
  ])
    expect(roomItemDetailFields(category), category).toEqual([]);
  expect(
    roomItemDetailFields("Backsplash", {
      notes: "Installation surface: Other material",
    }),
  ).toEqual([]);
  expect(
    roomItemDetailFields("Backsplash", { productName: "Porcelain tile" }).map((f) => f.label),
  ).toEqual(["Additional instructions"]);
  expect(
    roomItemDetailFields("Backsplash", { notes: "Additional instructions: 20 inch slab" }).map(
      (f) => f.label,
    ),
  ).toEqual(["Additional instructions"]);
  expect(roomItemDetailFields("Countertop").map((f) => f.label)).not.toContain("Backsplash height");
});

it("uses a published paint sheen without replacing manual choices or adding paint fields to tile", () => {
  expect(
    roomDetailValue(
      roomDesignScrapedNotes(
        "Keep existing trim",
        "Wall finish",
        "Interior Paint",
        "White Dove / Eggshell",
      ),
      "Paint sheen",
    ),
  ).toBe("Eggshell");
  expect(
    roomDesignScrapedNotes("Paint sheen: Satin", "Wall finish", "Interior Paint", "Matte"),
  ).toBe("Paint sheen: Satin");
  expect(roomDesignScrapedNotes("Paint sheen: TBD", "Wall finish", "Interior Paint", "Matte")).toBe(
    "Paint sheen: TBD",
  );
  expect(roomDesignScrapedNotes("", "Wall finish", "Matte porcelain tile", "Matte")).toBe("");
  expect(roomDesignScrapedNotes("", "Wall finish", "Interior Paint", "White Dove")).toBe("");
  expect(
    roomDesignTileIssues({ category: "Wall finish", productName: "Interior Paint", notes: "" }),
  ).toEqual([]);
});

it("remembers ownership and source details when shower scope is toggled, without touching other products", () => {
  const state = createDefaultRoomDesignWorkflowState("Hall Bathroom");
  const links = state.links.map((link) =>
    link.category === "Shower drain"
      ? {
          ...link,
          url: "https://example.com/drain",
          notes: "Selection responsibility: By builder\nPlacement / location: Centered",
        }
      : link,
  );
  const withoutShower = updateRoomScope(links, "Shower", "Not included");
  expect(roomScopeValue(withoutShower, "Shower")).toBe("Not included");
  expect(roomItemStatus(withoutShower.find((link) => link.category === "Shower drain")!)).toBe(
    "Not needed",
  );
  expect(withoutShower.find((link) => link.category === "Toilet")).toBe(
    links.find((link) => link.category === "Toilet"),
  );
  const restored = updateRoomScope(
    updateRoomScope(withoutShower, "Shower", "Not included"),
    "Shower",
    "Included",
  );
  expect(restored.find((link) => link.category === "Shower drain")).toMatchObject({
    url: "https://example.com/drain",
  });
  expect(roomItemStatus(restored.find((link) => link.category === "Shower drain")!)).toBe(
    "By builder",
  );
  expect(roomItemStatus(restored.find((link) => link.category === "Shower niche")!)).toBe(
    "Instructions only",
  );
});

function decision(
  notes = "Cabinet configuration: Two 30 inch bases; see elevation ID4",
): RoomDesignSelection {
  return {
    id: "layout",
    category: "Cabinet layout",
    productName: "Cabinet layout",
    vendor: "",
    finish: "",
    source: "Manual board",
    state: "locked",
    swatch: "",
    notes,
    quantity: null,
    scrapeStatus: "complete",
  };
}
it("reviews a documented layout without fake product links and keeps TBD decisions flagged", () => {
  expect(roomItemNeedsProduct(decision())).toBe(false);
  expect(roomItemNeedsProduct({ ...decision(), url: "https://example.com/cabinet" })).toBe(true);
  expect(roomDesignSelectionIssues(decision())).toEqual([]);
  expect(roomDesignOrderReady(decision())).toBe(false);
  expect(roomDesignSelectionIssues(decision("Cabinet configuration: TBD"))).not.toEqual([]);
  expect(roomDesignSelectionIssues(decision(""))).not.toEqual([]);
  expect(roomDesignSelectionIssues(decision("Selection responsibility: Not needed"))).toEqual([]);
});

it("round trips room instructions and responsibilities through shared saves and board notes", () => {
  const base = createDefaultRoomDesignWorkflowState("Kitchen");
  const selection = decision();
  const local = { ...base, selections: [selection] };
  const remote = {
    ...base,
    links: base.links.map((link) =>
      link.category === "Faucet" ? { ...link, url: "https://example.com/extension" } : link,
    ),
  };
  const merged = normalizeRoomDesignWorkflowState(mergeRoomDesignEdits(base, local, remote), base);
  expect(merged.selections[0].notes).toBe(selection.notes);
  expect(merged.links.find((link) => link.category === "Faucet")?.url).toContain("extension");
  const board = mergeRoomDesignSelectionsIntoBoard({
    boardState: {},
    projectName: "QA",
    roomId: "room",
    roomName: "Kitchen",
    selections: merged.selections,
  });
  const annotation = board.pages[0].elements.find((element) => element.id.includes(":selection:"))!;
  expect(annotation.type).toBe("text");
  expect(annotation.text).toContain("Two 30 inch bases");
  expect(annotation.materialExcludeFromMaterials).toBe(true);
  const skipped = mergeRoomDesignSelectionsIntoBoard({
    boardState: board,
    projectName: "QA",
    roomId: "room",
    roomName: "Kitchen",
    selections: [decision("Selection responsibility: Not needed")],
  });
  expect(
    skipped.pages
      .flatMap((page) => page.elements)
      .some((element) => element.id.includes(":selection:")),
  ).toBe(false);
});

it("synchronizes selected size and finish in both editing directions", () => {
  const previous = {
    notes: "Selected size / dimensions: 24 inches\nKeep this item",
    finish: "Brass",
    dimensions: "24 inches",
  };
  const changed = synchronizeRoomSelectionDetails(previous, {
    notes: "Selected size / dimensions: 30 inches\nKeep this item",
  });
  expect(changed.dimensions).toBe("30 inches");
  const edited = synchronizeRoomSelectionDetails(previous, { dimensions: "36 inches" });
  expect(roomDetailValue(edited.notes, "Selected size / dimensions")).toBe("36 inches");
  expect(edited.notes).toContain("Keep this item");
});

it("shows follow-ups only for the applicable item and current answer", () => {
  const labels = (category: string, notes = "", productName = "") =>
    roomItemDetailFields(category, { notes, productName }).map((field) => field.label);
  expect(labels("Cabinet hardware")).not.toContain("Pulls per drawer");
  expect(labels("Shower glass hardware")).not.toContain("Pulls per drawer");
  expect(labels("Cabinet hardware")).not.toContain("Drawer hardware exceptions");
  expect(labels("Cabinet hardware", "Pulls per drawer: Varies by drawer")).toEqual([]);
  expect(labels("Shower system")).not.toContain("Existing / committed model");
  expect(labels("Shower system")).toEqual([]);
  expect(labels("Faucet")).not.toContain("Fan diameter / downrod");
  expect(labels("Ceiling fan")).toEqual([]);
  expect(labels("Stair runner")).toEqual([]);
  expect(labels("Exterior paint touch-ups")).toContain("Paint sheen");
  expect(labels("Exterior paint touch-ups")).not.toContain("Selected size / dimensions");
  expect(labels("Backsplash")).not.toContain("Waterfall sides");
  expect(labels("Wall finish", "", "Porcelain tile")).not.toContain("Paint sheen");
  expect(labels("Wall finish", "", "Porcelain tile")).toEqual(["Additional instructions"]);
  expect(labels("Shower floor tile")).not.toContain("Installation height / extent");
  expect(labels("Wall finish")).not.toContain("Field verified by / date");
  expect(labels("Countertop", "Measurement status: Field verified")).toContain(
    "Field verified by / date",
  );
  expect(labels("Countertop")).not.toContain("Alternate product / reason");
  expect(labels("Countertop", "Substitution status: Awaiting approval")).toContain(
    "Alternate product / reason",
  );
});

it("keeps pending decisions, measurements and substitutions flagged while hidden stale answers do not block", () => {
  for (const notes of [
    "Selection decision: Inspiration only",
    "Measurement status: Field measurement needed",
    "Substitution status: Awaiting approval",
    "Purchase / installation state: Already installed",
  ])
    expect(roomDecisionIssues({ category: "Shower system", notes }).length).toBeGreaterThan(0);
  expect(
    roomDecisionIssues({ category: "Countertop", notes: "Measurement status: Field verified" }),
  ).toContain("Record who verified the measurements and when.");
  expect(
    roomDecisionIssues({
      category: "Countertop",
      notes: "Substitution status: No substitutions\nAlternate product / reason: TBD",
    }),
  ).toEqual([]);
  expect(
    roomDesignSelectionIssues(
      decision(
        "Cabinet configuration: Two bases\nSubstitution status: No substitutions\nAlternate product / reason: TBD",
      ),
    ),
  ).toEqual([]);
  expect(
    roomDesignOrderReady({
      ...decision("Selection decision: Approved for drawings"),
      url: "https://example.com/item",
    }),
  ).toBe(false);
});

it("tracks tile edge trim without requiring irrelevant trim fields for mitered edges", () => {
  let notes =
    "Grout color: MAPEI Avalanche\nGrout joint width: 1/8 inch\nTile layout: Vertical stack\nTile lay direction: Vertical";
  notes = updateRoomDesignTileNotes(notes, "edgeTreatment", "Metal trim");
  expect(roomDesignTileIssues({ category: "Shower wall tile", notes })).toContain(
    "Confirm the tile edge product, finish and size.",
  );
  for (const [field, value] of [
    ["edgeProduct", "Jolly"],
    ["edgeFinish", "Brushed nickel"],
    ["edgeSize", "3/8 inch"],
  ] as const)
    notes = updateRoomDesignTileNotes(notes, field, value);
  expect(roomDesignTileIssues({ category: "Shower wall tile", notes })).toEqual([]);
  notes = updateRoomDesignTileNotes(notes, "edgeFinish", "TBD");
  notes = updateRoomDesignTileNotes(notes, "edgeTreatment", "Mitered edges");
  expect(roomDesignTileIssues({ category: "Shower wall tile", notes })).toEqual([]);
  expect(
    roomDesignTileIssues({
      category: "Tile installation defaults",
      notes: "Grout color: MAPEI Avalanche",
    }),
  ).toEqual([]);
});

it("copies only applicable confirmed project defaults into blanks and preserves room exceptions", () => {
  const defaults = [
    {
      category: "Tile installation defaults",
      notes: "Grout color: MAPEI Avalanche\nGrout joint width: 1/8 inch\nTile layout: TBD",
    },
    {
      category: "Wall finish",
      notes:
        "Paint sheen: Matte\nPaint color / code: Snowbound\nSelected size / dimensions: 12 inches",
    },
  ];
  const tile = roomProjectDefaults(
    { category: "Shower wall tile", notes: "Grout color: Custom room white" },
    defaults,
  );
  expect(tile.count).toBe(1);
  expect(roomDetailValue(tile.notes, "Grout color")).toBe("Custom room white");
  expect(roomDetailValue(tile.notes, "Grout joint width")).toBe("1/8 inch");
  expect(roomDetailValue(tile.notes, "Tile layout")).toBe("");
  expect(roomProjectDefaults({ category: "Faucet", notes: "" }, defaults).count).toBe(0);
  const paint = roomProjectDefaults(
    { category: "Wall finish", notes: "Paint sheen: Satin" },
    defaults,
  );
  expect(roomDetailValue(paint.notes, "Paint sheen")).toBe("Satin");
  expect(roomDetailValue(paint.notes, "Selected size / dimensions")).toBe("");
});

it("flags related selected items after fit-affecting changes without changing their product choices", () => {
  const row = (id: string, category: string, notes = "") => ({
    id,
    category,
    notes,
    url: `https://example.com/${id}`,
    productId: id,
  });
  const before = [
    row("fridge", "Refrigerator", "Selected size / dimensions: 24 inches"),
    row("cab", "Cabinet layout", "Cabinet configuration: Keep these bases"),
    row("hardware", "Cabinet hardware"),
    row("top", "Countertop"),
    row("backsplash", "Backsplash"),
    row("drain", "Sink drain"),
    row("sink", "Sink"),
    row("faucet", "Faucet(s)"),
    row("kitchen-faucet", "Kitchen faucet"),
    row("light", "Island pendants"),
    { ...row("skip", "Sink"), notes: "Selection responsibility: Not needed" },
  ];
  const after = markRoomRelatedChanges(
    before,
    before.map((item) =>
      item.id === "fridge" ? { ...item, notes: "Selected size / dimensions: 30 inches" } : item,
    ),
  );
  for (const id of ["cab", "hardware", "sink"]) {
    const item = after.find((item) => item.id === id)!;
    expect(roomDetailValue(item.notes, "Related change review")).toContain("Refrigerator changed");
    expect(item.url).toBe(before.find((item) => item.id === id)!.url);
    expect(item.productId).toBe(id);
    expect(roomDecisionIssues(item).length).toBeGreaterThan(0);
  }
  expect(after.find((item) => item.id === "light")).toBe(
    before.find((item) => item.id === "light"),
  );
  expect(after.find((item) => item.id === "skip")).toBe(before.find((item) => item.id === "skip"));
  for (const id of ["faucet", "kitchen-faucet", "top", "backsplash", "drain"])
    expect(after.find((item) => item.id === id)).toBe(before.find((item) => item.id === id));
  const noFitChange = markRoomRelatedChanges(
    after,
    after.map((item) =>
      item.id === "fridge"
        ? { ...item, notes: `${item.notes}\nAdditional instructions: Left hinge` }
        : item,
    ),
  );
  expect(noFitChange.find((item) => item.id === "top")!.notes).toBe(
    after.find((item) => item.id === "top")!.notes,
  );
});

it("adds runner, fan and touch-up items only to suitable room templates", () => {
  expect(selectionItemsForRoom("Stairway").map((item) => item.label)).toContain("Stair runner");
  expect(selectionItemsForRoom("Guest Bedroom").map((item) => item.label)).toContain("Ceiling fan");
  expect(selectionItemsForRoom("Hall Bathroom").map((item) => item.label)).not.toContain(
    "Ceiling fan",
  );
  expect(selectionItemsForRoom("Project-wide finishes").map((item) => item.label)).toContain(
    "Exterior paint touch-ups",
  );
  expect(selectionItemsForRoom("Kitchen").map((item) => item.label)).not.toContain(
    "Exterior paint touch-ups",
  );
});
