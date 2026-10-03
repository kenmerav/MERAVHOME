import { describe, expect, it } from "vitest";
import { staleSpecBookMaterialIds, type BoardSourcedMaterial } from "../src/lib/specBookSources";

const projectId = "project-1";
const material: BoardSourcedMaterial = {
  id: "material-1", project_id: projectId, source_board_id: projectId,
  source_board_page_id: "old-page", source_board_element_id: "faucet",
};
const board = (elements: unknown[] = [], extra: object = {}) => ({
  pages: [{ id: "old-page", elements, ...extra }],
});

describe("Spec Book board source validation", () => {
  it("omits a selection whose original page was deleted", () => {
    expect(staleSpecBookMaterialIds(projectId, [material], { pages: [{ id: "new-page", elements: [] }] }))
      .toEqual([material.id]);
  });
  it("omits a removed layer without removing the rest of its room", () => {
    const current = { ...material, id: "material-2", source_board_element_id: "sink" };
    expect(staleSpecBookMaterialIds(projectId, [material, current], board([{ id: "sink" }])))
      .toEqual([material.id]);
  });
  it("keeps a repeated selection referenced on another page", () => {
    expect(staleSpecBookMaterialIds(projectId, [material], {
      pages: [{ id: "copy-page", elements: [{ id: "copy", materialItemId: material.id }] }],
    })).toEqual([]);
  });
  it("keeps selections on hidden pages and ignores presentation settings", () => {
    expect(staleSpecBookMaterialIds(projectId, [material], board([{ id: "faucet" }], {
      hidden: true, presentationVisible: false,
    }))).toEqual([]);
  });
  it("keeps manually added and incompletely linked legacy Materials", () => {
    const items = [
      { ...material, source_board_id: null },
      { ...material, source_board_page_id: null },
      { ...material, source_board_element_id: null },
    ];
    expect(staleSpecBookMaterialIds(projectId, items, board())).toEqual([]);
  });
  it("does not mix projects or board sources", () => {
    expect(staleSpecBookMaterialIds(projectId, [
      { ...material, project_id: "other-project" },
      { ...material, source_board_id: "other-board" },
    ], board())).toEqual([]);
  });
  it.each([undefined, null, {}, { pages: null }, { pages: [null] },
    { pages: [{ id: "page" }] }, board([{}]),
    { pages: [{ id: "page", elements: [] }, { id: "page", elements: [] }] },
  ])("does not hide materials when the board is unavailable or malformed: %j", (state) => {
    expect(staleSpecBookMaterialIds(projectId, [material], state)).toEqual([]);
  });
  it("restores a selection automatically when its page is restored", () => {
    expect(staleSpecBookMaterialIds(projectId, [material], { pages: [] })).toEqual([material.id]);
    expect(staleSpecBookMaterialIds(projectId, [material], board([{ id: "faucet" }]))).toEqual([]);
  });
  it("does not treat the same product in another room as the original selection", () => {
    expect(staleSpecBookMaterialIds(projectId, [material], {
      pages: [{ id: "kitchen", elements: [{ id: "faucet", materialItemId: "kitchen-material" }] }],
    })).toEqual([material.id]);
  });
  it("does not modify quantities, manual fields, procurement history or board state", () => {
    const item = { ...material, quantity: 2, notes: "Keep history", ordered: true };
    const state = board([{ id: "faucet" }]);
    const before = JSON.stringify({ item, state });
    staleSpecBookMaterialIds(projectId, [item], state);
    expect(JSON.stringify({ item, state })).toBe(before);
  });
});
