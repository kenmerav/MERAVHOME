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
      "Bathroom floor tile",
      "Bathroom wall tile",
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
      "Bathroom floor tile",
      "Bathroom wall tile",
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

const fullBathChanges = {
  add: ["Tub drain / overflow"],
  retire: ["Flooring"],
};

const roomChecklistChanges: Record<string, { add: string[]; retire?: string[] }> = {
  kitchen: {
    add: ["Decorative ceiling lighting", "Beverage refrigerator"],
    retire: ["General lighting", "Specialty appliances", "Shelf rails"],
  },
  "primary-bathroom": fullBathChanges,
  bathroom: fullBathChanges,
  "powder-bathroom": { add: [], retire: ["Flooring"] },
  laundry: { add: ["Floor drain", "Exhaust fan", "Wall plates"] },
  mudroom: { add: ["Wall plates"] },
  "built-ins-fireplace": { add: ["Fireplace hearth"] },
  stairs: { add: ["Stair treads", "Stair risers", "Balusters"] },
  pantry: {
    add: [
      "Cabinet finish", "Cabinet hardware", "Countertop", "Backsplash", "Open shelving",
      "Sink", "Faucet", "Beverage refrigerator",
    ],
    retire: ["Furniture", "Fixtures", "Hardware", "Accessories"],
  },
  bedroom: { add: ["Bed", "Nightstand", "Bedside lighting", "Area rug"] },
  dining: { add: ["Dining table", "Dining chair", "Chandelier", "Area rug"] },
  living: { add: ["Sofa", "Accent chair", "Coffee table", "Area rug"] },
  entry: { add: ["Entry console", "Mirror", "Area rug"] },
  office: { add: ["Desk", "Desk chair", "Task lighting"] },
  closet: { add: ["Closet shelving", "Hanging rail", "Drawer hardware"] },
};

function roomChecklistKey(roomName: string) {
  if (/primary.*bath/i.test(roomName)) return "primary-bathroom";
  if (/powder.*(?:bath|room)|half[ -]?bath/i.test(roomName)) return "powder-bathroom";
  if (/\b(?:pantry|scullery|butler(?:['’]s)?)\b/i.test(roomName)) return "pantry";
  if (/kitchen/i.test(roomName)) return "kitchen";
  if (/bath|restroom|washroom/i.test(roomName)) return "bathroom";
  if (/laundry|utility/i.test(roomName)) return "laundry";
  if (/mudroom|mud room/i.test(roomName)) return "mudroom";
  if (/built.?in|fireplace/i.test(roomName)) return "built-ins-fireplace";
  if (/project.?wide|whole.?home|whole.?house/i.test(roomName)) return "project-wide";
  if (/stair/i.test(roomName)) return "stairs";
  if (/\bcloset\b/i.test(roomName)) return "closet";
  if (/\bbedroom\b/i.test(roomName)) return "bedroom";
  if (/\bdining\b/i.test(roomName)) return "dining";
  if (/\b(?:living|family|great room|den)\b/i.test(roomName)) return "living";
  if (/\b(?:entry|foyer|entryway)\b/i.test(roomName)) return "entry";
  if (/\b(?:office|study)\b/i.test(roomName)) return "office";
  return SELECTION_ROOM_TEMPLATES.find((candidate) =>
    candidate.name.toLowerCase() === roomName.trim().toLowerCase(),
  )?.key || "";
}

export function selectionChecklistChangesForRoom(roomName: string) {
  const changes = roomChecklistChanges[roomChecklistKey(roomName)];
  return {
    addedKeys: (changes?.add || []).map((label) => item(label).key),
    retiredKeys: (changes?.retire || []).map((label) => item(label).key),
  };
}

export function selectionItemsForRoom(roomName: string): RequiredSelection[] {
  const key = roomChecklistKey(roomName);
  const template = SELECTION_ROOM_TEMPLATES.find((candidate) => candidate.key === key);
  const changes = roomChecklistChanges[key];
  const labels =
    template?.items.map((requiredItem) => requiredItem.label) ?? GENERIC_ROOM_ITEM_LABELS;
  const withFan = /bedroom|living|family|great room|\bden\b/i.test(roomName)
    ? [...labels, "Ceiling fan"]
    : labels;
  return [...new Set([...withFan, ...(changes?.add || [])])]
    .filter((label) => !changes?.retire?.includes(label))
    .map(item);
}

export function classifyBoardGroup(...values: Array<string | null | undefined>): BoardGroup {
  const text = values.filter(Boolean).join(" ").toLowerCase();

  if (/\b(?:countertop|island) power\b/.test(text)) return "Hardware";
  if (/\b(stair runner|stair treads?|stair risers?|fireplace hearth|area rug)\b/.test(text)) return "Materials";
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
  if (/\b(mirror|feature|decor|decorative object|art|sofa|chairs?|nightstand|beds?|(?:coffee|dining) table|entry console|desk)\b/.test(text)) {
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
    selectionItemsForRoom(room.name).map((requiredItem) => ({
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
