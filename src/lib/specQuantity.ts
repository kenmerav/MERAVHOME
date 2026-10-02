export type SpecQuantityUnit = "count" | "square_feet";

export type SpecQuantity = {
  quantity: number | null;
  quantity_tbd?: boolean;
  quantity_unit?: SpecQuantityUnit;
};

export type SpecQuantityPatch = {
  quantity: number | null;
  quantity_tbd: boolean;
  quantity_unit: SpecQuantityUnit;
};

export function specQuantityUnit(item: SpecQuantity): SpecQuantityUnit {
  return item.quantity_unit === "square_feet" ? "square_feet" : "count";
}

export function specQuantityUnitLabel(unit: SpecQuantityUnit) {
  return unit === "square_feet" ? "Sq Ft" : "Count";
}

export function specQuantityInput(item: SpecQuantity) {
  if (item.quantity_tbd) return "TBD";
  return item.quantity == null ? "" : String(item.quantity);
}

export function formatSpecQuantity(item: SpecQuantity) {
  const amount = specQuantityInput(item);
  if (!amount) return "";
  return specQuantityUnit(item) === "square_feet" ? `${amount} Sq Ft` : amount;
}

// Keep TBD separate from numeric quantity so arithmetic never treats it as 0 or 1.
export function parseSpecQuantity(value: string, unit: SpecQuantityUnit): SpecQuantityPatch {
  if (unit !== "count" && unit !== "square_feet") throw new Error("Choose Count or Sq Ft.");
  const text = value.trim();
  const base = { quantity_unit: unit, quantity_tbd: false };
  if (/^tbd$/i.test(text)) return { ...base, quantity: null, quantity_tbd: true };
  if (!text) return { ...base, quantity: null };
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) {
    throw new Error("Enter a non-negative number or TBD (up to 4 decimal places for Sq Ft).");
  }
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity > 1_000_000_000_000) {
    throw new Error("Enter a smaller quantity or TBD.");
  }
  if (unit === "count" && !Number.isInteger(quantity)) {
    throw new Error("Count must be a whole number. Choose Sq Ft for an area measurement.");
  }
  return { ...base, quantity };
}

export function validateSpecQuantityPatch(value: unknown): SpecQuantityPatch {
  if (!value || typeof value !== "object") throw new Error("Quantity is required.");
  const patch = value as Partial<SpecQuantityPatch>;
  if (typeof patch.quantity_tbd !== "boolean") throw new Error("Invalid quantity status.");
  if (patch.quantity_tbd && patch.quantity !== null) throw new Error("TBD cannot also have a number.");
  if (patch.quantity !== null && typeof patch.quantity !== "number") throw new Error("Invalid quantity.");
  return parseSpecQuantity(patch.quantity_tbd ? "TBD" : patch.quantity == null ? "" : String(patch.quantity), patch.quantity_unit as SpecQuantityUnit);
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
