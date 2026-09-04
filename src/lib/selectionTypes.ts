export const SELECTION_STATUSES = ["missing", "selected", "not_applicable"] as const;

export type SelectionStatus = (typeof SELECTION_STATUSES)[number];

export const BOARD_GROUPS = [
  "Materials",
  "Cabinetry / Millwork",
  "Plumbing",
  "Lighting",
  "Appliances",
  "Hardware",
  "Feature / Decor",
  "Architecture / Other",
] as const;

export type BoardGroup = (typeof BOARD_GROUPS)[number];

export type SelectionRecord = {
  id: string;
  localProjectKey: string;
  roomKey: string;
  roomName: string;
  requiredItemKey: string;
  requiredItemLabel: string;
  status: SelectionStatus;
  productUrl: string;
  productName: string;
  vendor: string;
  sku: string;
  finish: string;
  dimensions: string;
  price: string;
  imageUrl: string;
  originalImageUrl: string;
  backgroundRemovedImageUrl: string;
  backgroundRemovalStatus: "idle" | "processing" | "complete" | "failed";
  boardGroup: BoardGroup;
  boardElementId: string | null;
  boardPageId: string | null;
  placedOnBoard: boolean;
  autoPlaced: boolean;
  manuallyPositioned: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type SelectionBoardElement = {
  id: string;
  type: "image";
  selectionId: string;
  requiredItemKey: string;
  requiredItemLabel: string;
  boardGroup: BoardGroup;
  productUrl: string;
  productName: string;
  vendor: string;
  finish: string;
  imageUrl: string;
  originalImageUrl: string;
  status: SelectionStatus;
  backgroundRemoved: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
  zIndex: number;
  autoPlaced: boolean;
  manuallyPositioned: boolean;
  locked: boolean;
};

export type SelectionBoardPage = {
  id: string;
  roomKey: string;
  title: string;
  elements: SelectionBoardElement[];
};

export type SelectionPrototypeState = {
  version: 2;
  projectName: string;
  localProjectKey: string;
  includedRoomKeys: string[];
  selectedRoomKey: string;
  selections: SelectionRecord[];
  pages: SelectionBoardPage[];
  selectedPageId: string;
};

export type SelectionProgress = {
  required: number;
  selected: number;
  missing: number;
  notApplicable: number;
  linked: number;
  onBoard: number;
  remaining: number;
  completion: number;
};

export function calculateSelectionProgress(records: SelectionRecord[]): SelectionProgress {
  const requiredRecords = records.filter((record) => record.status !== "not_applicable");
  const selected = requiredRecords.filter((record) => record.status === "selected").length;
  const required = requiredRecords.length;

  return {
    required,
    selected,
    missing: Math.max(0, required - selected),
    notApplicable: records.filter((record) => record.status === "not_applicable").length,
    linked: requiredRecords.filter((record) => Boolean(record.productUrl.trim())).length,
    onBoard: requiredRecords.filter((record) => record.placedOnBoard).length,
    remaining: Math.max(0, required - selected),
    completion: required === 0 ? 100 : Math.round((selected / required) * 100),
  };
}

export function calculateProjectProgress(
  records: SelectionRecord[],
  includedRoomKeys: string[],
): SelectionProgress {
  const included = new Set(includedRoomKeys);
  return calculateSelectionProgress(records.filter((record) => included.has(record.roomKey)));
}
