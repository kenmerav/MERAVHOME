import { needsTileInstallation, tileDetailConfirmed } from "./tileInstallation";
import {
  tileManualAnswerConfirmed as roomDesignTileAnswerConfirmed,
  tileJointWidthConfirmed as roomDesignJointWidthConfirmed,
  tileJointWidthNeedsUnit,
} from "./tileManualAnswers";

type TileSelection = {
  category: string;
  productName?: string;
  catalogProductName?: string;
  notes?: string;
};
export type RoomDesignTileField =
  | "surface"
  | "location"
  | "groutColor"
  | "jointWidth"
  | "layout"
  | "direction"
  | "edgeTreatment"
  | "edgeProduct"
  | "edgeFinish"
  | "edgeSize";
const labels = {
  surface: "Installation surface",
  location: "Tile installation area",
  groutColor: "Grout color",
  jointWidth: "Grout joint width",
  layout: "Tile layout",
  direction: "Tile lay direction",
  edgeTreatment: "Tile edge treatment",
  edgeProduct: "Tile edge product / profile",
  edgeFinish: "Tile edge finish",
  edgeSize: "Tile edge size",
};
const lines = (notes = "") => notes.replace(/\\n/g, "\n").split("\n");

export function roomDesignTileFields(notes = "") {
  const read = (field: RoomDesignTileField) =>
    lines(notes)
      .find((line) => line.trim().toLowerCase().startsWith(`${labels[field].toLowerCase()}:`))
      ?.split(":")
      .slice(1)
      .join(":")
      .trimStart() || "";
  const legacyGrout = lines(notes)
    .find((line) => /^Grout:/i.test(line.trim()))
    ?.replace(/^\s*Grout:\s*/i, "");
  const legacyParts = legacyGrout?.match(/^(.+?),\s*(.+)$/);
  return {
    surface: read("surface"),
    location: read("location"),
    groutColor: read("groutColor") || legacyParts?.[1] || "",
    jointWidth:
      read("jointWidth") ||
      legacyParts?.[2]?.match(
        /^(.+?(?:["″]|\b(?:inch(?:es)?|in|mm|millimet(?:er|re)s?)\b))/i,
      )?.[1] ||
      legacyParts?.[2]?.replace(/\s+joints?\.?$/i, "") ||
      "",
    layout: read("layout"),
    direction: read("direction"),
    edgeTreatment: read("edgeTreatment"),
    edgeProduct: read("edgeProduct"),
    edgeFinish: read("edgeFinish"),
    edgeSize: read("edgeSize"),
  };
}

const pending =
  /\b(tbd|tbc|pending|unknown|unsure|undecided|not sure|to be (?:confirmed|selected|determined))\b/i;
const drawingReference =
  /\b(?:layout|installation|lay|direction).{0,40}(?:like|per|as shown|see).{0,40}(?:example|photo|image|board|drawing|reference)\b/i;

export function roomDesignTileLocation(item: TileSelection) {
  const location = roomDesignTileFields(item.notes).location;
  if (location) return location;
  // Specific checklist items already establish the surface; generic tile selections do not.
  return /\b(backsplash|floor|flooring|wall|surround|curb|threshold|bench|niche)\b/i.test(
    item.category,
  )
    ? item.category
    : "";
}

export function roomDesignTileDirectionConfirmed(notes = "") {
  const fields = roomDesignTileFields(notes);
  const text = fields.direction || notes;
  if (fields.direction) return roomDesignTileAnswerConfirmed(fields.direction);
  return lines(text).some(
    (line) =>
      !pending.test(line) &&
      (/\b(horizontal|vertical|diagonal|lengthwise|crosswise|parallel|perpendicular|long edge|short edge|north.south|east.west)\b/i.test(
        line,
      ) ||
        /\b(?:run|running|runs).{0,35}(?:toward|along|across|from|to the)\b/i.test(line) ||
        /\b(?:as supplied|factory|pre.?mounted).{0,25}(?:sheet|mosaic)\b/i.test(line) ||
        drawingReference.test(line)),
  );
}

/** Project installation choices travel through the existing notes -> board -> Materials path. */
export function updateRoomDesignTileNotes(
  notes: string | undefined,
  field: RoomDesignTileField,
  value: string,
) {
  if (field === "groutColor" || field === "jointWidth") {
    const current = roomDesignTileFields(notes);
    const next = { ...current, [field]: value };
    const remaining = lines(notes).filter(
      (line) => !/^\s*Grout(?: color| joint width)?\s*:/i.test(line),
    );
    return [
      ...remaining,
      ...(next.groutColor ? [`Grout color: ${next.groutColor}`] : []),
      ...(next.jointWidth ? [`Grout joint width: ${next.jointWidth}`] : []),
    ]
      .filter(Boolean)
      .join("\n");
  }
  const remaining = lines(notes).filter(
    (line) => !line.trim().toLowerCase().startsWith(`${labels[field].toLowerCase()}:`),
  );
  return [...remaining, ...(value.trim() ? [`${labels[field]}: ${value}`] : [])]
    .filter(Boolean)
    .join("\n");
}

export function roomDesignTileSurface(
  item: TileSelection,
): "tile" | "other" | "unknown" | "unrelated" {
  const productName = item.productName || item.catalogProductName || "";
  if (/tile installation defaults/i.test(item.category)) return "tile";
  if (
    /\b(?:paint|limewash|roman clay|plaster)\b/i.test(productName) &&
    !/\b(?:tile|mosaic|porcelain|ceramic)\b/i.test(productName)
  )
    return "other";
  // A known wood floor, slab backsplash or ceramic fixture must not acquire tile requirements.
  if (
    /\b(hardwood|engineered wood|wood flooring|vinyl|laminate|wallpaper|slab|wood(?:en)? panels?|mdf|pendants?|sconces?|lamps?|chandeliers?)\b/i.test(
      productName,
    )
  )
    return "other";
  if (
    needsTileInstallation({
      item_label: item.category,
      client_product_name: productName,
      is_required: false,
    })
  )
    return "tile";
  if (
    /\b(flooring|backsplash|wall finish|wall covering|fireplace surround)\b/i.test(item.category)
  ) {
    const surface = roomDesignTileFields(item.notes).surface;
    return surface === "Tile" ? "tile" : surface === "Other material" ? "other" : "unknown";
  }
  return "unrelated";
}

export function roomDesignTileIssues(item: TileSelection) {
  const surface = roomDesignTileSurface(item);
  if (surface === "unknown") return ["Choose whether this surface is tile or another material."];
  if (surface !== "tile") return [];
  const issues: string[] = [];
  const fields = roomDesignTileFields(item.notes);
  if (/tile installation defaults/i.test(item.category)) {
    if (
      [
        fields.groutColor,
        fields.jointWidth,
        fields.layout,
        fields.direction,
        fields.edgeTreatment,
      ].some((value) => pending.test(value))
    )
      issues.push("Confirm the remaining shared tile decisions.");
    if (
      ["Metal trim", "Pencil / bullnose"].includes(fields.edgeTreatment) &&
      [fields.edgeProduct, fields.edgeFinish, fields.edgeSize].some(
        (value) => !value.trim() || pending.test(value),
      )
    )
      issues.push("Confirm the tile edge product, finish and size.");
    return issues;
  }
  const location = roomDesignTileLocation(item);
  if (!location.trim() || pending.test(location)) issues.push("Confirm where this tile is used.");
  const explicitGrout = Boolean(fields.groutColor || fields.jointWidth);
  if (explicitGrout) {
    if (
      !roomDesignTileAnswerConfirmed(fields.groutColor) ||
      /^(?:mapei|laticrete|ardex|tec|prism|polyblend)$/i.test(fields.groutColor.trim())
    )
      issues.push("Enter the grout color and joint width.");
    else if (!roomDesignJointWidthConfirmed(fields.jointWidth))
      issues.push(
        tileJointWidthNeedsUnit(fields.jointWidth)
          ? "Add a unit to the grout joint width, for example 1 mm or 1/8 inch."
          : fields.jointWidth.trim() && !pending.test(fields.jointWidth)
            ? "Enter a valid grout joint width with units, for example 1 mm or 1/8 inch."
            : "Enter the grout color and joint width.",
      );
  } else if (!tileDetailConfirmed("grout", item.notes || ""))
    issues.push("Enter the grout color and joint width.");
  const patternNotes = lines(item.notes)
    .filter((line) => !/^\s*Tile lay direction\s*:/i.test(line))
    .join("\n");
  if (
    fields.layout
      ? !roomDesignTileAnswerConfirmed(fields.layout)
      : !tileDetailConfirmed("tile_layout", patternNotes)
  )
    issues.push("Enter the tile layout / pattern or approved drawing reference.");
  if (!roomDesignTileDirectionConfirmed(item.notes))
    issues.push("Enter the tile lay direction or approved drawing reference.");
  if (pending.test(fields.edgeTreatment)) issues.push("Confirm the tile edge treatment.");
  if (
    /^(?:Metal trim|Pencil \/ bullnose)$/i.test(fields.edgeTreatment) &&
    [fields.edgeProduct, fields.edgeFinish, fields.edgeSize].some(
      (value) => !value.trim() || pending.test(value),
    )
  )
    issues.push("Confirm the tile edge product, finish and size.");
  return issues;
}
