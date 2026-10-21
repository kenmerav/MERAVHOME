/** Retailer navigation and placeholder text are not product specifications. */
export function cleanProductDetail(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return /^(?:[-—–]|open (?:mobile )?menu|close (?:mobile )?menu|menu|navigation|skip to (?:main )?content|add to (?:cart|bag)|select (?:an? |your )?(?:option|finish|color|size)|choose (?:an? |your )?(?:option|finish|color|size)|finish needs review|needs review|tbd|unknown|n\/a|not (?:specified|selected|available)|pending)$/i.test(
    text,
  )
    ? ""
    : text;
}

/** An explicit undecided color is a saved room decision, not scraped product data. */
export function cleanRoomDesignFinish(value: unknown): string {
  return typeof value === "string" && /^tbd$/i.test(value.trim())
    ? "TBD"
    : cleanProductDetail(value);
}
