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
      "Shower wall tile",
      "Shower floor tile",
      "Shower system",
      "Shower drain",
      "Tub",
      "Tub filler",
      "Toilet",
      "Mirror(s)",
      "Vanity sconces",
      "Decorative ceiling lighting",
      "Hooks",
      "Switches",
      "Outlets",
      "Wall plates",
      "Recessed lighting",
      "Exhaust fan",
      "Toilet paper holder",
      "Hand towel holder",
      "Towel bar",
      "Shower glass / enclosure",
      "Shower glass hardware",
      "Shower niche",
      "Shower bench",
      "Shower curb / threshold",
      "Shower rough-in valve",
    ].map(item),
  },
  {
    key: "powder-bathroom",
    name: "Powder Bathroom",
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
      "Sink",
      "Faucet",
      "Toilet",
      "Mirror",
      "Vanity sconces",
      "Decorative ceiling lighting",
      "Recessed lighting",
      "Exhaust fan",
      "Toilet paper holder",
      "Hand towel holder",
      "Hooks",
      "Switches",
      "Outlets",
      "Wall plates",
    ].map(item),
  },
];

const bathroom = SELECTION_ROOM_TEMPLATES.find((template) => template.key === "primary-bathroom")!;
SELECTION_ROOM_TEMPLATES.push(
  { key: "bathroom", name: "Bathroom", items: bathroom.items.map((entry) => ({ ...entry })) },
  {
    key: "laundry",
    name: "Laundry",
    items: [
      "Flooring",
      "Transitions",
      "Wall finish",
      "Ceiling finish",
      "Baseboard",
      "Casing",
      "Doors",
      "Door hardware",
      "Cabinet layout",
      "Cabinet construction + door style",
      "Cabinet finish",
      "Cabinet hardware",
      "Countertop",
      "Backsplash",
      "Sink",
      "Faucet",
      "Washer",
      "Dryer",
      "Drying rack",
      "Hanging rail",
      "Utility / vent connections",
      "Lighting",
      "Outlets",
      "Switches",
    ].map(item),
  },
  {
    key: "mudroom",
    name: "Mudroom",
    items: [
      "Flooring",
      "Transitions",
      "Wall finish",
      "Ceiling finish",
      "Baseboard",
      "Casing",
      "Doors",
      "Door hardware",
      "Built-in layout",
      "Cabinet construction + door style",
      "Cabinet finish",
      "Cabinet hardware",
      "Bench",
      "Hooks",
      "Open shelving",
      "Lighting",
      "Outlets",
      "Switches",
    ].map(item),
  },
  {
    key: "built-ins-fireplace",
    name: "Built-ins / Fireplace",
    items: [
      "Built-in layout",
      "Cabinet construction + door style",
      "Cabinet finish",
      "Cabinet hardware",
      "Open shelving",
      "Fireplace",
      "Fireplace surround",
      "Mantel",
      "Accent lighting",
      "Outlets",
    ].map(item),
  },
  {
    key: "project-wide",
    name: "Project-wide finishes",
    items: [
      "Tile installation defaults",
      "Exterior paint touch-ups",
      "Flooring",
      "Transitions",
      "Wall finish",
      "Ceiling finish",
      "Baseboard",
      "Casing",
      "Doors",
      "Door hardware",
      "Switches",
      "Outlets",
      "Wall plates",
    ].map(item),
  },
);

SELECTION_ROOM_TEMPLATES.push({
  key: "stairs",
  name: "Stairs",
  items: [
    "Stair runner",
    "Flooring",
    "Transitions",
    "Wall finish",
    "Ceiling finish",
    "Baseboard",
    "Casing",
    "Lighting",
    "Handrail / railing",
  ].map(item),
});

const GENERIC_ROOM_ITEM_LABELS = [
  "Flooring",
  "Transitions",
  "Wall finish",
  "Ceiling finish",
  "Lighting",
  "Window treatments",
  "Furniture",
  "Fixtures",
  "Hardware",
  "Accessories",
];

export function selectionItemsForRoom(roomName: string): RequiredSelection[] {
  const template = SELECTION_ROOM_TEMPLATES.find((candidate) => {
    if (/primary.*bath/i.test(roomName)) return candidate.key === "primary-bathroom";
    if (/powder.*(?:bath|room)/i.test(roomName)) return candidate.key === "powder-bathroom";
    if (/kitchen/i.test(roomName)) return candidate.key === "kitchen";
    if (/bath|restroom|washroom/i.test(roomName)) return candidate.key === "bathroom";
    if (/laundry|utility/i.test(roomName)) return candidate.key === "laundry";
    if (/mudroom|mud room/i.test(roomName)) return candidate.key === "mudroom";
    if (/built.?in|fireplace/i.test(roomName)) return candidate.key === "built-ins-fireplace";
    if (/project.?wide|whole.?home|whole.?house/i.test(roomName))
      return candidate.key === "project-wide";
    if (/stair/i.test(roomName)) return candidate.key === "stairs";
    return candidate.name.toLowerCase() === roomName.toLowerCase();
  });
  const labels =
    template?.items.map((requiredItem) => requiredItem.label) ?? GENERIC_ROOM_ITEM_LABELS;
  const withFan = /bedroom|living|family|great room|\bden\b/i.test(roomName)
    ? [...labels, "Ceiling fan"]
    : labels;
  return [...new Set(withFan)].map(item);
}

export function classifyBoardGroup(...values: Array<string | null | undefined>): BoardGroup {
  const text = values.filter(Boolean).join(" ").toLowerCase();

  if (/\b(?:countertop|island) power\b/.test(text)) return "Hardware";
  if (/\bstair runner\b/.test(text)) return "Materials";
  if (/\bceiling fan\b/.test(text)) return "Lighting";

  if (
    /\b(countertop|backsplash|floor|flooring|transition|tile|stone|slab|paint|wall finish|ceiling finish)\b/.test(
      text,
    )
  ) {
    return "Materials";
  }
  if (
    /\b(cabinet hardware|vanity hardware|door hardware|hardware|knobs?|pulls?|hooks?|bath accessories|towel bar|towel holder|toilet paper holder|flange|plates?|switches?|outlets?)\b/.test(
      text,
    )
  ) {
    return "Hardware";
  }
  if (
    /\b(sink|faucet|pot filler|drain|disposal|toilet|shower system|shower rough-in valve|tub|tub filler|freestanding tub|plumbing)\b/.test(
      text,
    )
  ) {
    return "Plumbing";
  }
  if (/\b(pendants?|sconces?|chandeliers?|lights?|lighting|lanterns?|recessed)\b/.test(text)) {
    return "Lighting";
  }
  if (
    /\b(dishwasher|range|cooktop|oven|hood insert|refrigerator|freezer|microwave|appliance|washer|dryer|exhaust fan)\b/.test(
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
