export const SPEC_QUANTITY_UNITS = {
  count: "Count",
  square_feet: "Sq Ft",
  linear_feet: "Linear Ft",
  pair: "Pair",
  set: "Set",
  box: "Box",
  carton: "Carton",
  slab: "Slab",
  roll: "Roll",
  gallon: "Gallon",
} as const;
export type SpecQuantityUnit = keyof typeof SPEC_QUANTITY_UNITS;
export function validSpecQuantityUnit(value: unknown): value is SpecQuantityUnit {
  return typeof value === "string" && Object.hasOwn(SPEC_QUANTITY_UNITS, value);
}
export function specQuantityUnitFromSelection(unit?: string): SpecQuantityUnit {
  return (
    (
      { each: "count", "sq ft": "square_feet", "linear ft": "linear_feet" } as Record<
        string,
        SpecQuantityUnit
      >
    )[unit || ""] || (validSpecQuantityUnit(unit) ? unit : "count")
  );
}
export type SelectionQuantityUnit =
  "each" | "sq ft" | "linear ft" | "pair" | "set" | "box" | "carton" | "slab" | "roll" | "gallon";
export function selectionQuantityUnitFromSpec(unit?: string): SelectionQuantityUnit {
  const value =
    ({ count: "each", square_feet: "sq ft", linear_feet: "linear ft" } as Record<string, string>)[
      unit || ""
    ] || unit;
  return [
    "each",
    "sq ft",
    "linear ft",
    "pair",
    "set",
    "box",
    "carton",
    "slab",
    "roll",
    "gallon",
  ].includes(value || "")
    ? (value as SelectionQuantityUnit)
    : "each";
}

export type SpecQuantity = {
  quantity: number | null;
  quantity_tbd?: boolean;
  quantity_unit?: SpecQuantityUnit;
  selection_quantity_unit?: SpecQuantityUnit | null;
  waste_percent?: number;
};

export type SpecQuantityPatch = {
  quantity: number | null;
  quantity_tbd: boolean;
  quantity_unit: SpecQuantityUnit;
  waste_percent?: number;
};

export function specQuantityUnit(item: SpecQuantity): SpecQuantityUnit {
  return validSpecQuantityUnit(item.selection_quantity_unit)
    ? item.selection_quantity_unit
    : validSpecQuantityUnit(item.quantity_unit)
      ? item.quantity_unit
      : "count";
}

/** The original two-unit column remains compatible with older Studio clients. */
export function specQuantityDatabasePatch(patch: SpecQuantityPatch) {
  return {
    ...patch,
    quantity_unit:
      patch.quantity_unit === "square_feet" ? ("square_feet" as const) : ("count" as const),
    selection_quantity_unit: patch.quantity_unit,
  };
}

export function specQuantityUnitLabel(unit: SpecQuantityUnit) {
  return SPEC_QUANTITY_UNITS[unit];
}

export function specQuantityInput(item: SpecQuantity) {
  if (item.quantity_tbd) return "TBD";
  return item.quantity == null ? "" : String(item.quantity);
}

export function formatSpecQuantity(item: SpecQuantity) {
  const amount = specQuantityInput(item);
  if (!amount) return "";
  return specQuantityUnit(item) === "count"
    ? amount
    : `${amount} ${specQuantityUnitLabel(specQuantityUnit(item))}`;
}

export function specOrderQuantity(item: SpecQuantity) {
  if (item.quantity_tbd || item.quantity == null) return null;
  return Math.round(item.quantity * (1 + (item.waste_percent || 0) / 100) * 10000) / 10000;
}

export function specWasteLabel(item: SpecQuantity) {
  if (!item.waste_percent) return "";
  const amount = specOrderQuantity(item);
  return `${item.waste_percent}% waste · Order ${amount == null ? "TBD" : formatSpecQuantity({ ...item, quantity: amount })}`;
}

// Keep TBD separate from numeric quantity so arithmetic never treats it as 0 or 1.
export function parseSpecQuantity(
  value: string,
  unit: SpecQuantityUnit,
  waste?: number,
): SpecQuantityPatch {
  if (!validSpecQuantityUnit(unit)) throw new Error("Choose a valid measurement.");
  if (waste !== undefined && (!Number.isFinite(waste) || waste < 0 || waste > 100))
    throw new Error("Waste must be between 0 and 100 percent.");
  const text = value.trim();
  const base = {
    quantity_unit: unit,
    quantity_tbd: false,
    ...(waste === undefined ? {} : { waste_percent: waste }),
  };
  if (/^tbd$/i.test(text)) return { ...base, quantity: null, quantity_tbd: true };
  if (!text) return { ...base, quantity: null };
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) {
    throw new Error("Enter a non-negative number or TBD (up to 4 decimal places for Sq Ft).");
  }
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity > 1_000_000_000_000) {
    throw new Error("Enter a smaller quantity or TBD.");
  }
  if (
    ["count", "pair", "set", "box", "carton", "slab"].includes(unit) &&
    !Number.isInteger(quantity)
  ) {
    throw new Error("Count, pair, set, box, carton and slab quantities must be whole numbers.");
  }
  return { ...base, quantity };
}

export function validateSpecQuantityPatch(value: unknown): SpecQuantityPatch {
  if (!value || typeof value !== "object") throw new Error("Quantity is required.");
  const patch = value as Partial<SpecQuantityPatch>;
  if (typeof patch.quantity_tbd !== "boolean") throw new Error("Invalid quantity status.");
  if (patch.quantity_tbd && patch.quantity !== null)
    throw new Error("TBD cannot also have a number.");
  if (patch.quantity !== null && typeof patch.quantity !== "number")
    throw new Error("Invalid quantity.");
  return parseSpecQuantity(
    patch.quantity_tbd ? "TBD" : patch.quantity == null ? "" : String(patch.quantity),
    patch.quantity_unit as SpecQuantityUnit,
    patch.waste_percent,
  );
}

export function invoiceQuantityNumber(value: string) {
  const quantity = Number(value.trim());
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

export function invoiceQuantityInput(item?: SpecQuantity | null) {
  if (item?.quantity_tbd) return "TBD";
  return String(item?.quantity && item.quantity > 0 ? item.quantity : 1);
}

export function invoiceQuantityReady(value: string, unit: SpecQuantityUnit = "count") {
  try {
    const patch = parseSpecQuantity(value, unit);
    return !patch.quantity_tbd && patch.quantity !== null && patch.quantity > 0;
  } catch {
    return false;
  }
}
