/** Only labelled dimensions with explicit units are accepted; missing axes stay blank. */
export function dimensionInches(
  text: string,
  precision: number | null = 3,
): [string, string, string] {
  const result: [string, string, string] = ["", "", ""];
  const normalized = text
    .replace(/½/g, " 1/2")
    .replace(/¼/g, " 1/4")
    .replace(/¾/g, " 3/4")
    .replace(/⅛/g, " 1/8")
    .replace(/⅜/g, " 3/8")
    .replace(/⅝/g, " 5/8")
    .replace(/⅞/g, " 7/8");
  const value = "(\\d+(?:\\.\\d+)?(?:[ -]+\\d+\\/\\d+)?|\\d+\\/\\d+)";
  const unit = '(mm|cm|inches|inch|in\\b|["″])';
  const dimension = "(width|wide|height|high|depth|deep|diameter|dia\\.?|w|h|d)";
  const leadingDimension = "(width|height|depth|diameter|dia\\.?|[whd](?=\\s*[:=]))";
  const expressions = [
    new RegExp(`\\b${leadingDimension}\\s*[:=]?\\s*${value}\\s*${unit}`, "gi"),
    new RegExp(`\\b${value}\\s*${unit}\\s*${dimension}\\b`, "gi"),
  ];
  const candidates: number[][] = [[], [], []];
  const consumed: [number, number][] = [];
  for (const [order, re] of expressions.entries())
    for (const match of normalized.matchAll(re)) {
      const start = match.index!,
        end = start + match[0].length;
      if (order === 1 && consumed.some(([a, b]) => start < b && end > a)) continue;
      if (order === 0) consumed.push([start, end]);
      const [label, raw, u] =
        order === 0 ? [match[1], match[2], match[3]] : [match[3], match[1], match[2]];
      const parts = raw
        .replace(/(\d)-(\d+\/\d+)/, "$1 $2")
        .trim()
        .split(/\s+/);
      const amount = parts.reduce((sum, p) => {
        const f = p.split("/").map(Number);
        return sum + (f.length === 2 ? f[0] / f[1] : f[0]);
      }, 0);
      const inches =
        amount / (u.toLowerCase() === "mm" ? 25.4 : u.toLowerCase() === "cm" ? 2.54 : 1);
      if (!Number.isFinite(inches) || inches <= 0 || inches > 100000 / 25.4) continue;
      const axis = /^h/i.test(label)
        ? [1]
        : /^w/i.test(label)
          ? [0]
          : /^dia/i.test(label)
            ? [0, 2]
            : [2];
      axis.forEach((i) => candidates[i].push(inches));
    }
  candidates.forEach((values, i) => {
    // Contradictory dimensions remain unresolved rather than silently taking the first.
    if (values.length && values.every((n) => Math.abs(n - values[0]) < 0.01))
      result[i] = precision === null ? String(values[0]) : String(+values[0].toFixed(precision));
  });
  return result;
}
