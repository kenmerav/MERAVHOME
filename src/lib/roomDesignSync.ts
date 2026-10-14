import type { RoomDesignWorkflowState } from "@/lib/roomDesignWorkflow";

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function roomDesignStatesEqual(
  left: RoomDesignWorkflowState,
  right: RoomDesignWorkflowState,
) {
  const { updatedAt: _left, ...a } = left;
  const { updatedAt: _right, ...b } = right;
  return same(a, b);
}

// Apply only changes made since the page's last observed version. An extension
// import in another item must survive a save from an already-open editor.
export function mergeRoomDesignEdits(
  base: RoomDesignWorkflowState,
  local: RoomDesignWorkflowState,
  remote: RoomDesignWorkflowState,
): RoomDesignWorkflowState {
  const field = (before: unknown, mine: unknown, theirs: unknown, name: string) => {
    if (same(mine, before)) return theirs;
    if (!same(theirs, before) && !same(mine, theirs))
      throw new Error(
        `${name} changed in Studio while you were editing. Refresh the room before changing that item again.`,
      );
    return mine;
  };
  const rows = <T extends { id: string }>(before: T[], mine: T[], theirs: T[]): T[] => {
    const b = new Map(before.map((row) => [row.id, row]));
    const l = new Map(mine.map((row) => [row.id, row]));
    const r = new Map(theirs.map((row) => [row.id, row]));
    const result: T[] = [];
    for (const id of new Set([...r.keys(), ...l.keys(), ...b.keys()])) {
      const old = b.get(id),
        own = l.get(id),
        other = r.get(id);
      if (!own || !other) {
        const chosen = field(old, own, other, id) as T | undefined;
        if (chosen) result.push(chosen);
        continue;
      }
      const merged: Record<string, unknown> = {};
      for (const key of new Set([
        ...Object.keys(old ?? {}),
        ...Object.keys(other),
        ...Object.keys(own),
      ]))
        merged[key] = field(
          old?.[key as keyof T],
          own[key as keyof T],
          other[key as keyof T],
          `${own.id}: ${key}`,
        );
      result.push(merged as T);
    }
    return result;
  };
  const merged = {
    ...remote,
    links: rows(base.links, local.links, remote.links),
    selections: rows(base.selections, local.selections, remote.selections),
  };
  for (const key of Object.keys(remote) as Array<keyof RoomDesignWorkflowState>) {
    if (["links", "selections", "updatedAt"].includes(key)) continue;
    (merged as Record<string, unknown>)[key] = field(base[key], local[key], remote[key], key);
  }
  return merged;
}
