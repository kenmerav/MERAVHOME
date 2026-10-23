export function parseRoomDesignQuantity(value: unknown): number | null {
  if (value === null || (typeof value === "string" && /^tbd$/i.test(value.trim()))) return null;
  if (value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Enter a positive quantity or TBD.");
  const text = String(value).trim();
  const quantity = Number(text);
  if (
    !/^\d+(?:\.\d{1,4})?$/.test(text) ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > 1_000_000_000_000
  )
    throw new Error("Enter a positive quantity or TBD.");
  return quantity;
}

export function roomDesignQuantityLabel(value: number | null | undefined) {
  return value == null ? "TBD" : String(value);
}
