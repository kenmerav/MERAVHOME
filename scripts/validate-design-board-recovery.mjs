import assert from "node:assert/strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeBoardState(label = "Board 1") {
  return {
    selectedPageId: "page-1",
    pages: [
      {
        id: "page-1",
        title: label,
        roomId: null,
        elements: [],
      },
    ],
    comments: [],
    versions: [],
  };
}

function createStore() {
  return {
    board: null,
    updatedAt: null,
    versions: [],
  };
}

function saveBoard(store, nextState, expectedUpdatedAt) {
  if (store.board && expectedUpdatedAt !== store.updatedAt) {
    return { ok: false, reason: "stale-save-rejected" };
  }

  if (!store.board) {
    store.board = clone(nextState);
    store.updatedAt = "t1";
    store.versions.push({
      version_id: "v-create",
      project_id: "project-1",
      design_board_id: "project-1",
      board_state_snapshot: clone(nextState),
      save_type: "create",
    });
    return { ok: true, updatedAt: store.updatedAt };
  }

  store.versions.push({
    version_id: `v-${store.versions.length + 1}`,
    project_id: "project-1",
    design_board_id: "project-1",
    board_state_snapshot: clone(store.board),
    save_type: "update",
  });
  store.board = clone(nextState);
  store.updatedAt = `t${store.versions.length + 1}`;
  return { ok: true, updatedAt: store.updatedAt };
}

function deleteBoard(store) {
  assert.ok(store.board, "board should exist before delete");
  store.versions.push({
    version_id: `v-${store.versions.length + 1}`,
    project_id: "project-1",
    design_board_id: "project-1",
    board_state_snapshot: clone(store.board),
    save_type: "delete",
  });
  store.board = null;
  store.updatedAt = null;
}

function restoreLatestVersion(store) {
  const latest = store.versions.at(-1);
  assert.ok(latest, "expected at least one archived version");
  store.board = clone(latest.board_state_snapshot);
  store.updatedAt = `restore-${store.versions.length + 1}`;
  return store.board;
}

const store = createStore();
const initial = makeBoardState("Recovered Pot Filler");
initial.pages[0].elements.push({
  id: "chair-1",
  type: "image",
  src: "https://cdn.example/chair.png",
  x: 100,
  y: 100,
  width: 220,
  height: 220,
  zIndex: 1,
  visible: true,
});

let result = saveBoard(store, initial, null);
assert.equal(result.ok, true, "initial save should succeed");
const firstUpdatedAt = result.updatedAt;

const second = clone(initial);
second.pages[0].elements[0].x = 180;
result = saveBoard(store, second, firstUpdatedAt);
assert.equal(result.ok, true, "second save should succeed");
assert.equal(store.versions.length, 2, "create + prior snapshot should be archived");

const corrupt = makeBoardState("Corrupt");
corrupt.pages[0].elements.push({
  id: "broken",
  type: "image",
  src: "https://cdn.example/bad.png",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  zIndex: 1,
  visible: true,
});
store.board = clone(corrupt);
const restoredAfterCorruption = restoreLatestVersion(store);
assert.equal(
  restoredAfterCorruption.pages[0].elements[0].x,
  100,
  "restoring after corruption should recover the archived good state",
);

deleteBoard(store);
assert.equal(store.board, null, "delete should remove the live board");
const restoredAfterDelete = restoreLatestVersion(store);
assert.equal(
  restoredAfterDelete.pages[0].title,
  "Recovered Pot Filler",
  "deleted board should be recoverable from archived versions",
);

const staleCandidate = clone(restoredAfterDelete);
staleCandidate.pages[0].title = "Stale local edit";
const staleResult = saveBoard(store, staleCandidate, "old-updated-at");
assert.equal(staleResult.ok, false, "stale save must be rejected");
assert.equal(staleResult.reason, "stale-save-rejected");

console.log("Design board recovery validation passed.");
