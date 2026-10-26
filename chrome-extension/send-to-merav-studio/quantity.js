function parseMeravQuantity(value) {
  const text = String(value ?? "").trim();
  if (/^tbd$/i.test(text)) return "TBD";
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error("Enter a positive quantity or TBD.");
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0 || number > 1_000_000_000_000)
    throw new Error("Enter a positive quantity or TBD.");
  return number;
}

function initialMeravQuantity(category) {
  const text = String(category || "").trim();
  if (/\bshower door\b.*\b(handles?|pulls?|hinges?|knobs?)\b/i.test(text)) return 1;
  return /\b(tile|tiles|backsplash|cabinetry|cabinets?|cupboards?|drawers?|doors?|baseboard|casing)\b|\bbase\s*&\s*case\b/i.test(
    text,
  )
    ? "TBD"
    : 1;
}

function restoredMeravQuantity(item, remembered) {
  if (remembered !== undefined) return remembered;
  if (item?.quantity === null) return "TBD";
  if (item?.quantity !== undefined) return item.quantity;
  return initialMeravQuantity(item?.category || item?.label);
}
