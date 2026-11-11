import { createHash } from "node:crypto";
import {
  createDefaultRoomDesignWorkflowState,
  normalizeRoomDesignWorkflowState,
  reconcileRoomDesignChecklist,
  type RoomDesignWorkflowState,
} from "./roomDesignWorkflow";

export function extensionRoomWorkflow(roomName: string, saved: unknown) {
  const initial = createDefaultRoomDesignWorkflowState(roomName);
  const state = normalizeRoomDesignWorkflowState(saved, initial);
  return reconcileRoomDesignChecklist(state.links.length ? state : initial, roomName);
}

export function extensionSelectionRevision(state: RoomDesignWorkflowState, itemId: string) {
  const link = state.links.find((item) => item.id === itemId);
  if (!link) return "";
  const selection = state.selections.find((item) => item.id === `link-${itemId}`);
  return createHash("sha256")
    .update(JSON.stringify([link, selection]))
    .digest("hex");
}
