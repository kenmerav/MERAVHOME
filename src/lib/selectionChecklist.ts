import type { BoardGroup, SelectionRecord } from "@/lib/selectionTypes";

export type RequiredSelection = {
  key: string;
  label: string;
};

export type SelectionRoomTemplate = {
  key: string;
  name: string;
  items: RequiredSelection[];
};

function item(label: string): RequiredSelection {
  return {
    key: label
      .toLowerCase()
      .replace(/\+/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    label,
  };
}

export const SELECTION_ROOM_TEMPLATES: SelectionRoomTemplate[] = [
  {
    key: "kitchen",
    name: "Kitchen",
    items: [
      "Flooring",
      "Transitions",
      "Wall finish",
      "Ceiling finish",
      "Baseboard",
      "Casing",
      "Doors",
      "Door hardware",
      "General lighting",
      "Recessed lighting",
      "Switches",
      "Outlets",
      "Wall plates",
      "Cabinet layout",
      "Appliance layout",
      "Cabinet construction + door style",
      "Cabinet finish",
      "Cabinet hardware",
      "Countertop",
      "Backsplash",
      "Sink",
      "Faucet",
      "Sink drain",
      "Garbage disposal",
      "Sink flange",
      "Air switch",
      "Dishwasher",
      "Range / cooktop",
      "Wall oven(s)",
      "Hood insert",
      "Decorative hood shell",
      "Refrigerator",
      "Freezer",
      "Microwave / drawer",
      "Specialty appliances",
      "Pot filler",
      "Open shelving",
      "Shelf rails",
      "Island pendants",
      "Sconces",
      "Accent lighting",
      "Under-cabinet lighting",
      "Cabinet interior lighting",
      "Countertop power",
      "Island power",
    ].map(item),
  },
  {
    key: "primary-bathroom",
    name: "Primary Bathroom",
    items: [
      "Flooring",
      "Transitions",
      "Wall finish",
      "Ceiling finish",
      "Baseboard",
      "Casing",
      "Doors",
      "Door hardware",
      "Vanity layout",
      "Vanity construction + door style",
      "Vanity finish",
      "Vanity hardware",
      "Countertop",
      "Backsplash",
      "Sink(s)",
      "Faucet(s)",
      "Sink drain(s)",
      "Shower wall tile",
      "Shower floor tile",
      "Shower system",
      "Shower drain",
      "Freestanding tub",
      "Tub filler",
      "Toilet",
      "Mirror(s)",
      "Vanity sconces",
      "Decorative ceiling lighting",
      "Bath accessories",
      "Hooks",
      "Switches",
      "Outlets",
      "Wall plates",
    ].map(item),
  },
];

export function classifyBoardGroup(...values: Array<string | null | undefined>): BoardGroup {
  const text = values.filter(Boolean).join(" ").toLowerCase();

  if (
    /\b(countertop|backsplash|floor|flooring|transition|tile|stone|slab|paint|wall finish|ceiling finish)\b/.test(
      text,
    )
  ) {
    return "Materials";
  }
  if (
    /\b(cabinet hardware|vanity hardware|door hardware|hardware|knobs?|pulls?|hooks?|bath accessories|flange|plates?|switches?|outlets?)\b/.test(
      text,
    )
  ) {
    return "Hardware";
  }
  if (
    /\b(sink|faucet|pot filler|drain|disposal|toilet|shower system|tub filler|freestanding tub|plumbing)\b/.test(
      text,
    )
  ) {
    return "Plumbing";
  }
  if (/\b(pendants?|sconces?|chandeliers?|lights?|lighting|lanterns?|recessed)\b/.test(text)) {
    return "Lighting";
  }
  if (
    /\b(dishwasher|range|cooktop|oven|hood insert|refrigerator|freezer|microwave|appliance)\b/.test(
      text,
    )
  ) {
    return "Appliances";
  }
  if (/\b(mirror|feature|decor|decorative object|art)\b/.test(text)) {
    return "Feature / Decor";
  }
  if (
    /\b(cabinet|cabinetry|millwork|hood shell|shelving|shelf|rails|vanity|built-in)\b/.test(text)
  ) {
    return "Cabinetry / Millwork";
  }
  return "Architecture / Other";
}

export function createInitialSelectionRecords(
  localProjectKey: string,
  options: { now?: string; idFactory?: () => string } = {},
): SelectionRecord[] {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());

  return SELECTION_ROOM_TEMPLATES.flatMap((room) =>
    room.items.map((requiredItem) => ({
      id: idFactory(),
      localProjectKey,
      roomKey: room.key,
      roomName: room.name,
      requiredItemKey: requiredItem.key,
      requiredItemLabel: requiredItem.label,
      status: "missing" as const,
      productUrl: "",
      productName: "",
      vendor: "",
      sku: "",
      finish: "",
      dimensions: "",
      price: "",
      imageUrl: "",
      originalImageUrl: "",
      backgroundRemovedImageUrl: "",
      backgroundRemovalStatus: "idle" as const,
      boardGroup: classifyBoardGroup(requiredItem.label),
      boardElementId: null,
      boardPageId: null,
      placedOnBoard: false,
      autoPlaced: false,
      manuallyPositioned: false,
      notes: "",
      createdAt: now,
      updatedAt: now,
    })),
  );
}
