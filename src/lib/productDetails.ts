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

/** Room Design has one color/finish display field; keep both published parts. */
export function productColorFinish(value: {
  color?: unknown;
  finish?: unknown;
  color_options?: string[];
}) {
  const color = cleanProductDetail(value.color),
    finish = cleanProductDetail(value.finish);
  if (
    (value.color_options?.length ?? 0) > 1 &&
    !color &&
    !value.color_options?.some((option) => option.toLowerCase() === finish.toLowerCase())
  )
    return "";
  if (!color || !finish) return color || finish;
  if (finish.toLowerCase().includes(color.toLowerCase())) return finish;
  if (color.toLowerCase().includes(finish.toLowerCase())) return color;
  return `${color} / ${finish}`;
}
