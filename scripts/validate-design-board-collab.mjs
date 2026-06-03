import assert from "node:assert/strict";

const initialState = {
  selectedPageId: "page-1",
  pages: [
    {
      id: "page-1",
      title: "Design Board 1",
      roomId: null,
      elements: [],
    },
  ],
  versions: [],
};

function applyPatch(state, patch) {
  if (patch.kind === "restore-state") return clone(patch.state);
  if (patch.kind === "select-page") return { ...state, selectedPageId: patch.pageId };
  if (patch.kind === "upsert-page") {
    const exists = state.pages.some((page) => page.id === patch.page.id);
    return {
      ...state,
      selectedPageId: exists ? state.selectedPageId : patch.page.id,
      pages: exists
        ? state.pages.map((page) => (page.id === patch.page.id ? { ...page, ...patch.page } : page))
        : [...state.pages, patch.page],
    };
  }
  if (patch.kind === "patch-page") {
    return {
      ...state,
      pages: state.pages.map((page) =>
        page.id === patch.pageId ? { ...page, ...patch.patch } : page,
      ),
    };
  }
  return {
    ...state,
    pages: state.pages.map((page) => {
      if (page.id !== patch.pageId) return page;
      if (patch.kind === "upsert-layer") {
        const exists = page.elements.some((layer) => layer.id === patch.layer.id);
        return {
          ...page,
          elements: exists
            ? page.elements.map((layer) =>
                layer.id === patch.layer.id ? { ...layer, ...patch.layer } : layer,
              )
            : [...page.elements, patch.layer],
        };
      }
      if (patch.kind === "patch-layer") {
        return {
          ...page,
          elements: page.elements.map((layer) =>
            layer.id === patch.layerId ? { ...layer, ...patch.patch } : layer,
          ),
        };
      }
      if (patch.kind === "delete-layer") {
        return { ...page, elements: page.elements.filter((layer) => layer.id !== patch.layerId) };
      }
      if (patch.kind === "bulk-patch-layers") {
        const patches = new Map(patch.patches.map((item) => [item.layerId, item.patch]));
        return {
          ...page,
          elements: page.elements.map((layer) =>
            patches.has(layer.id) ? { ...layer, ...patches.get(layer.id) } : layer,
          ),
        };
      }
      return page;
    }),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pageLayers(state) {
  return state.pages.find((page) => page.id === "page-1")?.elements ?? [];
}

function layerById(state, id) {
  return pageLayers(state).find((layer) => layer.id === id);
}

function assertNoInlineImages(state) {
  for (const layer of pageLayers(state)) {
    assert.ok(
      !String(layer.src ?? "").startsWith("data:image/"),
      `${layer.id} stored an inline image`,
    );
    assert.ok(
      !String(layer.originalSrc ?? "").startsWith("data:image/"),
      `${layer.id} stored an inline original image`,
    );
  }
}

let shared = clone(initialState);

shared = applyPatch(shared, {
  kind: "upsert-layer",
  pageId: "page-1",
  layer: {
    id: "chair-1",
    type: "image",
    src: "https://storage.example/chair.png",
    x: 100,
    y: 120,
    width: 180,
    height: 180,
    rotation: 0,
    zIndex: 1,
    label: "Chair",
    notes: "",
    link: "https://vendor.example/chair",
    locked: false,
    visible: true,
  },
});

shared = applyPatch(shared, {
  kind: "upsert-layer",
  pageId: "page-1",
  layer: {
    id: "lamp-1",
    type: "image",
    src: "https://storage.example/lamp.png",
    x: 340,
    y: 90,
    width: 90,
    height: 220,
    rotation: 0,
    zIndex: 2,
    label: "Lamp",
    notes: "",
    link: "https://vendor.example/lamp",
    locked: false,
    visible: true,
  },
});

assert.equal(
  pageLayers(shared).length,
  2,
  "concurrent adds should append layers instead of replacing the board",
);

shared = applyPatch(shared, {
  kind: "patch-layer",
  pageId: "page-1",
  layerId: "chair-1",
  patch: { x: 145, y: 160, width: 210, height: 210, rotation: 7 },
});

shared = applyPatch(shared, {
  kind: "patch-layer",
  pageId: "page-1",
  layerId: "lamp-1",
  patch: { label: "Lamp Option A", notes: "Check finish", link: "https://vendor.example/lamp-a" },
});

assert.equal(
  layerById(shared, "chair-1")?.x,
  145,
  "geometry patch should update the selected layer",
);
assert.equal(
  layerById(shared, "lamp-1")?.label,
  "Lamp Option A",
  "metadata patch should update the selected layer",
);
assert.equal(
  layerById(shared, "chair-1")?.label,
  "Chair",
  "metadata patch should not overwrite other layers",
);

shared = applyPatch(shared, {
  kind: "bulk-patch-layers",
  pageId: "page-1",
  patches: [
    { layerId: "chair-1", patch: { zIndex: 4 } },
    { layerId: "lamp-1", patch: { zIndex: 3, visible: false, locked: true } },
  ],
});

assert.equal(layerById(shared, "chair-1")?.zIndex, 4, "layer reorder should patch only zIndex");
assert.equal(layerById(shared, "lamp-1")?.visible, false, "hidden state should be patchable");
assert.equal(layerById(shared, "lamp-1")?.locked, true, "locked state should be patchable");

const version = clone(shared);

shared = applyPatch(shared, { kind: "delete-layer", pageId: "page-1", layerId: "chair-1" });
assert.equal(pageLayers(shared).length, 1, "delete should remove only the targeted layer");
assert.ok(layerById(shared, "lamp-1"), "delete should preserve unrelated layers");

shared = applyPatch(shared, { kind: "restore-state", state: version });
assert.equal(pageLayers(shared).length, 2, "version restore should recover prior board state");
assert.equal(
  layerById(shared, "lamp-1")?.notes,
  "Check finish",
  "version restore should recover layer metadata",
);

assertNoInlineImages(shared);

console.log("Design board collaboration validation passed.");
