import { roomDesignTileSurface } from "./roomDesignTile";
/** Project-specific instructions live in workflow/board notes, never the shared catalog. */
export const ROOM_ITEM_STATUSES = [
  "Choose product",
  "Existing / keep",
  "By builder",
  "By client",
  "Not needed",
  "TBD",
  "Instructions only",
] as const;
export type RoomItemStatus = (typeof ROOM_ITEM_STATUSES)[number];
type RoomItemContext = {
  category: string;
  notes?: string;
  url?: string;
  productId?: string | null;
  imageUrl?: string;
};
export function roomDetailValue(notes: string | undefined, label: string) {
  return (
    (notes || "")
      .split(/\r?\n/)
      .find((line) => line.startsWith(`${label}:`))
      ?.slice(label.length + 1)
      .trim() || ""
  );
}
export function updateRoomDetail(notes: string | undefined, label: string, value: string) {
  const lines = (notes || "").split(/\r?\n/).filter((line) => !line.startsWith(`${label}:`));
  if (value.trim()) lines.push(`${label}: ${value.trim().replace(/\r?\n/g, " ")}`);
  return lines.filter(Boolean).join("\n");
}
export function isRoomInstructionCategory(category: string) {
  return /(?:cabinet|vanity|appliance) layout|(?:cabinet|vanity) construction|shower niche|shower bench|shower curb|threshold|built-in layout|tile installation defaults/i.test(
    category,
  );
}
export function roomItemStatus(item: RoomItemContext): RoomItemStatus {
  const value = roomDetailValue(item.notes, "Selection responsibility");
  return ROOM_ITEM_STATUSES.includes(value as RoomItemStatus)
    ? (value as RoomItemStatus)
    : isRoomInstructionCategory(item.category) &&
        !item.url?.trim() &&
        !item.productId &&
        !item.imageUrl
      ? "Instructions only"
      : "Choose product";
}
export function roomItemNeedsProduct(item: RoomItemContext) {
  return roomItemStatus(item) === "Choose product";
}
export function roomItemCanOrder(item: RoomItemContext) {
  const decision = roomDetailValue(item.notes, "Selection decision");
  return roomItemNeedsProduct(item) && (!decision || decision === "Approved for ordering");
}
export function roomDesignInitialQuantity(category: string) {
  return /flooring|stair runner|tile|backsplash|countertop(?! power)|baseboard|casing|transition|wall finish|ceiling finish|(?:cabinet|vanity) finish|layout/i.test(
    category,
  )
    ? null
    : 1;
}
export type RoomDetailField = {
  label: string;
  placeholder: string;
  options?: string[];
  section?: string;
};
const f = (label: string, placeholder: string): RoomDetailField => ({ label, placeholder });
const choice = (label: string, options: string[], section?: string): RoomDetailField => ({
  label,
  placeholder: "Choose",
  options,
  section,
});
const omitRelatedFitReview = (category: string) =>
  /\bfaucets?\b|\bbacksplash(?:es)?\b|\bcounter\s?tops?\b|\bsinks?\b.*\b(?:drains?|strainers?)\b/i.test(
    category,
  );

/** Simple selections do not need a separate related-fit task in the room checklist. */
export function roomRelatedFitReview(item: { category: string; notes?: string }) {
  return omitRelatedFitReview(item.category)
    ? ""
    : roomDetailValue(item.notes, "Related change review");
}

/** Hide obsolete fit tasks in the checklist summary without changing saved notes. */
export function roomItemSummaryNotes(item: { category: string; notes?: string }) {
  const notes = item.notes || "";
  return omitRelatedFitReview(item.category)
    ? notes
        .split(/\r?\n/)
        .filter((line) => !/^Related change review:/i.test(line.trim()))
        .join("\n")
    : notes;
}
export function roomItemDetailFields(
  category: string,
  context: { notes?: string; productName?: string } = {},
): RoomDetailField[] {
  if (
    /^(?:door hardware|decorative ceiling lighting|doors?|exhaust fans?)$/i.test(category.trim()) ||
    /\b(?:cabinet|vanity) hardware\b|\bdishwashers?\b/i.test(category)
  )
    return [];
  const value = (label: string) => roomDetailValue(context.notes, label);
  const tile = roomDesignTileSurface({ category, ...context }) === "tile";
  let fields: RoomDetailField[] = [];
  // Product name, brand, color, model and standard dimensions belong to the
  // scraped product review, rather than a second form before gathering.
  if (tile) fields = [];
  else if (/paint|wall finish|ceiling finish/i.test(category))
    fields = [f("Paint sheen", "e.g. Matte or eggshell")];
  else if (/countertop/i.test(category) && !/power|outlet/i.test(category))
    fields = [
      f("Material thickness", "e.g. 1.5 in; island 3 in"),
      f("Edge profile", "e.g. Eased"),
      f("Overhang", "If applicable; e.g. 12 in at seating"),
    ];
  else if (/(?:cabinet|vanity) finish/i.test(category)) fields = [];
  else if (/shelv|shelf rails/i.test(category))
    fields = [
      f("Shelf dimensions / spacing", "Custom shelf dimensions and spacing"),
      f("Shelf support / mounting", "Floating supports, brackets or rails"),
    ];
  else if (/hood shell/i.test(category))
    fields = [
      f("Hood shell dimensions", "Custom dimensions or drawing reference"),
      f("Hood shell finish", "Custom material / finish"),
    ];
  else if (
    /cabinet|vanity (?:layout|construction)|built-in/i.test(category) &&
    !/light/i.test(category)
  )
    fields = [
      f("Cabinet construction", "Overlay or inset"),
      f("Door / drawer style", "Selected door and drawer style"),
      f("Cabinet configuration", "Custom layout or drawing reference"),
    ];
  else if (/shower glass|enclosure/i.test(category) && !/hardware/i.test(category))
    fields = [
      f("Glass height", "Height or drawing reference"),
      f("Glass / door swing", "Hinge side and swing"),
      f("Glass hardware finish", "Selected hardware finish"),
    ];
  else if (/shower niche|shower bench|shower curb|threshold/i.test(category))
    fields = [
      f("Shower detail dimensions", "Custom width, height and depth"),
      f("Shower detail material", "e.g. Slab top and tile sides"),
      f("Shower detail height / location", "Location or drawing reference"),
    ];
  else if (/appliance|refrigerator|dishwasher/i.test(category))
    fields = /layout/i.test(category)
      ? [f("Appliance location", "Layout or drawing reference")]
      : [f("Panel requirements", "Panel-ready details, if applicable")];
  // Standard products need the scraped product review, not an empty second
  // installation form. Tile and custom work retain an optional note; existing
  // project notes remain available for genuine exceptions on other selections.
  const hasProjectNotes = context.notes
    ?.split(/\r?\n/)
    .some(
      (line) =>
        line.trim() &&
        !/^(?:Installation surface|Selection responsibility|Previous selection responsibility|Shower scope|Tub scope|Selected size \/ dimensions|Selected color \/ finish):/i.test(
          line.trim(),
        ),
    );
  const omitNotes = /\b(?:sinks?|faucets?|fridges?|refrigerators?|freezers?)\b/i.test(category);
  if (!omitNotes && (fields.length || tile || hasProjectNotes))
    fields.push(f("Additional instructions", "Optional installation notes or drawing reference"));

  // Previously saved decisions remain editable without asking every item for
  // approval paperwork or measurements again.
  const finalSection = "Saved decisions";
  if (value("Selection decision") || value("Substitution status")) {
    fields.push(
      choice(
        "Selection decision",
        [
          "Inspiration only",
          "Proposed",
          "Approved for drawings",
          "Approved for ordering",
          "Needs confirmation",
        ],
        finalSection,
      ),
    );
    if (value("Selection decision"))
      fields.push(
        ...[
          f("Approved option / reference", "Exact approved option"),
          f("Governing drawing / revision", "Document / revision"),
          f("Decision approved by / date", "Who confirmed the choice and when"),
        ].map((field) => ({ ...field, section: finalSection })),
      );
    fields.push(
      choice(
        "Substitution status",
        ["No substitutions", "Proposed alternate", "Awaiting approval", "Approved alternate"],
        finalSection,
      ),
    );
    if (value("Substitution status") && value("Substitution status") !== "No substitutions")
      fields.push(
        ...[
          f("Alternate product / reason", "Exact alternate and reason"),
          f("Alternate approved by / date", "Who approved and when"),
        ].map((field) => ({ ...field, section: finalSection })),
      );
  }
  if (value("Measurement status")) {
    const section = "Saved measurements";
    fields.push(
      choice(
        "Measurement status",
        ["From drawings", "Field measurement needed", "Field verified"],
        section,
      ),
    );
    fields.push(
      ...[
        f("Measurement source / reference", "Drawing or site reference"),
        ...(value("Measurement status") === "Field verified"
          ? [f("Field verified by / date", "Who measured and when")]
          : [f("Measurement owner", "Who will confirm")]),
      ].map((field) => ({ ...field, section })),
    );
  }
  return fields;
}

export function roomDecisionIssues(item: { category: string; notes?: string }) {
  if (roomItemStatus(item) === "Not needed") return [];
  const issues: string[] = [];
  const value = (label: string) => roomDetailValue(item.notes, label);
  if (["Inspiration only", "Proposed", "Needs confirmation"].includes(value("Selection decision")))
    issues.push("Confirm the final selection before marking it reviewed.");
  if (/^Approved for /.test(value("Selection decision")) && !value("Decision approved by / date"))
    issues.push("Record who approved the final choice and when.");
  if (
    ["Already ordered", "Already installed", "Existing / retain"].includes(
      value("Purchase / installation state"),
    ) &&
    !value("Existing / committed model")
  )
    issues.push("Confirm the installed or ordered model this selection must work with.");
  if (["Proposed alternate", "Awaiting approval"].includes(value("Substitution status")))
    issues.push("The proposed substitution still needs approval.");
  if (
    value("Substitution status") === "Approved alternate" &&
    (!value("Alternate product / reason") || !value("Alternate approved by / date"))
  )
    issues.push("Document the approved alternate and who approved it.");
  if (value("Measurement status") === "Field measurement needed")
    issues.push("Field measurements still need confirmation.");
  if (value("Measurement status") === "Field verified" && !value("Field verified by / date"))
    issues.push("Record who verified the measurements and when.");
  const fitReview = roomRelatedFitReview(item);
  if (fitReview) issues.push(fitReview);
  return issues;
}
export function roomItemInstructionIssues(item: { category: string; notes?: string }) {
  const status = roomItemStatus(item);
  if (status === "Not needed") return [];
  if (status === "TBD") return ["Selection responsibility / decision is TBD."];
  const fields = roomItemDetailFields(item.category, item);
  const values = fields
    .filter((field) => !field.section)
    .map((field) => roomDetailValue(item.notes, field.label));
  const legacyReferences = ["Placement / location", "Reference drawing / image"].map((label) =>
    roomDetailValue(item.notes, label),
  );
  if (
    ![...values, ...legacyReferences].some(
      (value) => value && !/^(?:TBD|decide later)$/i.test(value),
    )
  )
    return ["Add instructions, placement or a reference for this decision."];
  if (values.some((value) => /\bTBD\b|to be (?:decided|confirmed)/i.test(value)))
    return ["Resolve the remaining TBD installation details."];
  return [];
}

/** Use a published paint sheen when available, preserving the designer's choice. */
export function roomDesignScrapedNotes(
  notes: string | undefined,
  category: string,
  productName: string,
  finish: string,
) {
  if (
    !/paint|wall finish|ceiling finish|(?:cabinet|vanity) finish/i.test(category) ||
    roomDesignTileSurface({ category, productName, notes }) === "tile" ||
    roomDetailValue(notes, "Paint sheen")
  )
    return notes || "";
  const sheen = finish.match(
    /\b(?:semi[- ]?gloss|high[- ]?gloss|low[- ]?lust(?:re|er)|medium[- ]?lust(?:re|er)|eggshell|matte|satin|flat|gloss)\b/i,
  )?.[0];
  return sheen ? updateRoomDetail(notes, "Paint sheen", sheen) : notes || "";
}

export function roomItemShowsTileFields(item: {
  category: string;
  notes?: string;
  url?: string;
  productId?: string | null;
}) {
  return !["Existing / keep", "Not needed", "TBD"].includes(roomItemStatus(item));
}

/** Copies confirmed shared finishes into blank fields only; room exceptions win. */
export function roomProjectDefaults(
  item: { category: string; notes?: string; productName?: string },
  defaults: Array<{ category: string; notes?: string }>,
) {
  const same = defaults.find(
    (entry) => entry.category.toLowerCase() === item.category.toLowerCase(),
  );
  const tile = roomDesignTileSurface(item) === "tile";
  const tileDefaults = defaults.find((entry) => /tile installation defaults/i.test(entry.category));
  const sources = [...(same ? [same] : []), ...(tile && tileDefaults ? [tileDefaults] : [])];
  let notes = item.notes || "";
  const allowed = [
    "Grout color",
    "Grout joint width",
    "Tile layout",
    "Tile lay direction",
    "Tile edge treatment",
    "Tile edge product / profile",
    "Tile edge finish",
    "Tile edge size",
    "Paint brand",
    "Paint color / code",
    "Paint sheen",
    "Cabinet construction",
    "Door / drawer style",
    "Paint / stain",
    "Wood species / cut",
    "Material / finish",
    "Profile / size",
    "Hardware size / centers",
    "Hardware assignment",
    "Pulls per drawer",
    "Selected color / finish",
  ];
  let count = 0;
  for (const source of sources)
    for (const label of allowed) {
      if (
        ["Tile edge product / profile", "Tile edge finish", "Tile edge size"].includes(label) &&
        !["Metal trim", "Pencil / bullnose"].includes(roomDetailValue(notes, "Tile edge treatment"))
      )
        continue;
      if (label.startsWith("Tile ") || label.startsWith("Grout ")) {
        if (!tile) continue;
      } else if (!roomItemDetailFields(item.category, item).some((field) => field.label === label))
        continue;
      const value = roomDetailValue(source.notes, label);
      if (
        !roomDetailValue(notes, label) &&
        value &&
        !/\bTBD\b|pending|to be confirmed/i.test(value)
      ) {
        notes = updateRoomDetail(notes, label, value);
        count++;
      }
    }
  if (count)
    notes = updateRoomDetail(
      notes,
      "Shared detail source",
      "Project-wide finishes; room exceptions retained",
    );
  return { notes, count };
}

const coordinationSource = (category: string) =>
  /(?:cabinet|vanity|appliance) layout|(?:cabinet|vanity) construction|dishwasher|range|cooktop|oven|hood insert|refrigerator|freezer|microwave|washer|dryer/i.test(
    category,
  );
const coordinationTarget = (category: string) =>
  !omitRelatedFitReview(category) &&
  /cabinet|vanity|countertop|sink|backsplash|hood|appliance|refrigerator|range|oven|dishwasher|freezer|microwave/i.test(
    category,
  );
const fitLabels = [
  "Selected size / dimensions",
  "Appliance model",
  "Cabinet configuration",
  "Cabinet construction",
  "Panel requirements",
  "Existing / committed model",
];
export function markRoomRelatedChanges<
  T extends {
    id: string;
    category: string;
    url?: string;
    productId?: string | null;
    notes: string;
  },
>(before: T[], after: T[]) {
  const changed = after.filter((item) => {
    const prior = before.find((other) => other.id === item.id);
    return (
      prior &&
      coordinationSource(item.category) &&
      (prior.url !== item.url ||
        prior.productId !== item.productId ||
        fitLabels.some(
          (label) => roomDetailValue(prior.notes, label) !== roomDetailValue(item.notes, label),
        ))
    );
  });
  if (!changed.length) return after;
  return after.map((item) => {
    const causes = changed.filter((source) => source.id !== item.id);
    if (
      !causes.length ||
      !coordinationTarget(item.category) ||
      roomItemStatus(item) === "Not needed"
    )
      return item;
    // Empty untouched rows need no extra task until they have a selection or instructions.
    if (!item.url && !item.productId && !item.notes.trim()) return item;
    const prior = roomDetailValue(item.notes, "Related change review");
    const reason = `Recheck fit after ${causes.map((source) => source.category).join(", ")} changed.`;
    return {
      ...item,
      notes: updateRoomDetail(
        item.notes,
        "Related change review",
        prior.includes(reason) ? prior : [prior, reason].filter(Boolean).join(" "),
      ),
    };
  });
}

export function roomScopeValue(
  links: Array<{ category: string; notes?: string }>,
  scope: "Shower" | "Tub",
) {
  const rows = links.filter((link) => isRoomScopeItem(link.category, scope));
  const values = rows.map((link) => roomDetailValue(link.notes, `${scope} scope`));
  return values.length && values.every((value) => value === values[0]) ? values[0] : "";
}
export function isRoomScopeItem(category: string, scope: "Shower" | "Tub") {
  return scope === "Shower" ? /^shower /i.test(category) : /^(?:tub|tub filler)$/i.test(category);
}
export function updateRoomScope<T extends { category: string; notes: string }>(
  links: T[],
  scope: "Shower" | "Tub",
  value: string,
): T[] {
  return links.map((link) => {
    if (!isRoomScopeItem(link.category, scope)) return link;
    let notes = updateRoomDetail(link.notes, `${scope} scope`, value);
    if (value === "Not included") {
      if (roomDetailValue(link.notes, `${scope} scope`) !== "Not included")
        notes = updateRoomDetail(notes, "Previous selection responsibility", roomItemStatus(link));
      notes = updateRoomDetail(notes, "Selection responsibility", "Not needed");
    } else if (roomDetailValue(link.notes, `${scope} scope`) === "Not included") {
      if (roomItemStatus(link) === "Not needed")
        notes = updateRoomDetail(
          notes,
          "Selection responsibility",
          roomDetailValue(link.notes, "Previous selection responsibility"),
        );
      notes = updateRoomDetail(notes, "Previous selection responsibility", "");
    }
    return { ...link, notes };
  });
}

/** Keep a manual choice consistent when edited from either details panel. */
export function synchronizeRoomSelectionDetails<
  T extends { notes?: string; finish?: string; dimensions?: string },
>(previous: T, patch: Partial<T>): Partial<T> {
  const next = { ...patch };
  let notes = patch.notes ?? previous.notes;
  for (const [field, label] of [
    ["finish", "Selected color / finish"],
    ["dimensions", "Selected size / dimensions"],
  ] as const) {
    if (field in patch) notes = updateRoomDetail(notes, label, String(patch[field] || ""));
    else if (
      "notes" in patch &&
      roomDetailValue(notes, label) !== roomDetailValue(previous.notes, label)
    )
      (next as Record<string, unknown>)[field] = roomDetailValue(notes, label);
  }
  if (notes !== previous.notes || "notes" in patch) next.notes = notes as T["notes"];
  return next;
}
