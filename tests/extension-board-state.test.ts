import { describe, expect, it } from "vitest";
import { normalizeExtensionBoardState } from "../src/lib/extensionBoardState";

describe("extension board imports preserve existing settings", () => {
  const page = {
    id: "hidden-page", title: "Original option", roomId: "room-one",
    hidden: true, presentationVisible: false,
    roomApprovalStatus: "declined", declinedMaterialItems: [{ id: "old-material" }],
    materialsSyncFingerprint: "saved-fingerprint",
    materialsSyncSnapshot: { hidden: true, materialImages: [] },
    materialsSyncedAt: "2026-10-01T12:00:00Z",
    futurePageSetting: { keep: true },
    elements: [{ id: "existing-layer", type: "image", materialExcludeFromMaterials: true }],
  };
  const board = {
    pages: [page, { id: "den", title: "Den", roomId: "room-two", elements: [] }],
    selectedPageId: "den", comments: [{ id: "comment-one" }], versions: [],
    presentationExtraPages: [{ id: "extra-slide" }],
    presentationSlideOrder: ["extra-slide"], presentationSlidePicks: { "extra-slide": true },
    presentationHiddenSections: ["internal"], presentationHiddenSlideKeys: ["hidden-page"],
    presentationRenderingOverrides: { "room-one": "rendering-one" },
    futureBoardSetting: { keep: true },
  };
  it("preserves every page and project setting while adding a layer to another page", () => {
    const state = normalizeExtensionBoardState(board);
    const next = { ...state, pages: state.pages.map(p => p.id === "den"
      ? { ...p, elements: [...p.elements, { id: "new-layer", type: "image" }] } : p) };
    expect(next.pages[0]).toEqual(page);
    expect({ ...next, pages: board.pages }).toEqual(board);
    expect(next.pages[1].elements).toEqual([{ id: "new-layer", type: "image" }]);
    expect(board.pages[1].elements).toEqual([]);
  });
  it("preserves explicit true/false and absent visibility fields without inventing approval", () => {
    for (const hidden of [true, false]) {
      expect(normalizeExtensionBoardState({ pages: [{ ...page, hidden }] }).pages[0].hidden).toBe(hidden);
    }
    const plain = normalizeExtensionBoardState({ pages: [{ id: "plain", elements: [] }] }).pages[0];
    expect(plain).not.toHaveProperty("hidden");
    expect(plain).not.toHaveProperty("roomApprovalStatus");
  });
  it("keeps page order, selected page, comments and saved history", () => {
    expect(normalizeExtensionBoardState(board)).toEqual(board);
  });
  it.each([null, undefined, [], "bad", { pages: [] }])("supports empty/invalid legacy boards: %j", (input) => {
    const result = normalizeExtensionBoardState(input);
    expect(result.pages).toEqual([{ id: "board-1", title: "Design Board 1", roomId: null, elements: [] }]);
    expect(result.selectedPageId).toBe("board-1");
  });
  it("ignores invalid pages/layers and retains valid layer metadata", () => {
    const result = normalizeExtensionBoardState({ pages: [null, [], { ...page, elements: [null, [], 1, ...page.elements] }], selectedPageId: "missing" });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].elements).toEqual(page.elements);
    expect(result.selectedPageId).toBe(page.id);
  });
  it("is idempotent across repeated imports", () => {
    const first = normalizeExtensionBoardState(board);
    expect(normalizeExtensionBoardState(first)).toEqual(first);
  });
});
