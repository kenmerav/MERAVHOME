function parseMeravQuantity(value) {
  const text = String(value ?? "").trim();
  if (/^tbd$/i.test(text)) return "TBD";
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error("Enter a positive quantity or TBD.");
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0 || number > 1_000_000_000_000)
    throw new Error("Enter a positive quantity or TBD.");
  return number;
}
