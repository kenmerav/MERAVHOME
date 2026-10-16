import type { DrawingMatchItem } from "./specDrawingMatches";

// Normalize spelling/layout, not meaning: never turn a sink into a faucet or
// a shower drain into a sink drain. PDF line breaks are handled by short windows.
export function drawingNameWords(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/roughcut/g, "rough cut")
    .replace(/limewash/g, "lime wash")
    .replace(/countertops?/g, "countertop")
    .replace(
      /\b(sconces|pendants|faucets|sinks|toilets|cabinets|knobs|pulls|mirrors|drains|hooks|walls|tiles)\b/g,
      (word) => word.slice(0, -1),
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
const ordinary = new Set(
  (
    "a an the and of for with in on at to by over under from x w " +
    "bath bathroom kitchen shower tub wall floor ceiling vanity room " +
    "sink faucet toilet drain strainer lever paper holder towel ring bar hook system set pot filler " +
    "pendant sconce light lighting fixture bulb mount flush chandelier " +
    "cabinet cabinetry knob pull backplate handle hardware countertop tile stone mirror quartzite granite marble porcelain slab " +
    "paint finish color stain panel door rail post end corner thru " +
    "white black grey gray brass bronze chrome nickel gold silver polished brushed satin matte " +
    "single double two three one hole inch handle traditional modern linear vertical horizontal " +
    "round square rectangle rectangular elongated wide high long deep size sample unlabeled item " +
    "front apron top rough cut lime wash paints home hardware collection"
  ).split(/\s+/),
);
const objectWords = new Set(
  (
    "sink faucet toilet shower system pot filler drain strainer lever holder towel ring bar hook pendant sconce light " +
    "chandelier cabinet cabinetry knob pull backplate countertop tile stone mirror paint panel rail"
  ).split(" "),
);
const contains = (haystack: string[], phrase: string[]) =>
  ` ${haystack.join(" ")} `.includes(` ${phrase.join(" ")} `);
function fixturePhraseAppears(words: string[], phrase: string[]) {
  if (!contains(words, phrase)) return false;
  if (
    phrase.length === 1 &&
    /^(sconce|pendant|chandelier|light)$/.test(phrase[0]) &&
    /\b(bulb|bulbs)\b/.test(words.join(" "))
  )
    return false;
  if (
    phrase.length === 1 &&
    phrase[0] === "sink" &&
    /\b(faucet|sconce|pendant|chandelier|light|lighting|flush mount)\b/.test(words.join(" "))
  )
    return false;
  return !(
    phrase.length === 1 &&
    /^(toilet|sink|shower|faucet)$/.test(phrase[0]) &&
    /\b(drain|strainer|lever|paper|holder|rough in)\b/.test(words.join(" "))
  );
}

function itemPhrases(item: DrawingMatchItem) {
  const roomWords = new Set(drawingNameWords(item.room));
  const phrases = [item.label, item.clientName || "", item.name]
    .map((value) => drawingNameWords(value.split("|")[0]))
    .map((words) => words.filter((word) => !roomWords.has(word)))
    .filter((words) => words.length && words.some((word) => objectWords.has(word)));
  const label = drawingNameWords(item.label).join(" ");
  // Item labels often carry placement words ("range sconces"). Match the
  // fixture type only when the same-room uniqueness check can distinguish it.
  if (!/\b(bulb|bulbs|drain|strainer|lever|holder|backplate|rough)\b/.test(label)) {
    if (/\bshower (system|faucet|set)\b/.test(label)) {
      phrases.push(["shower", "system"], ["shower", "faucet"], ["shower", "set"]);
    } else if (!/\bpot filler\b/.test(label)) {
      for (const type of [
        "sconce",
        "pendant",
        "chandelier",
        "flush mount",
        "faucet",
        "sink",
        "mirror",
        "toilet",
      ]) {
        if (new RegExp(`\\b${type}\\b`).test(label)) {
          phrases.push(type.split(" "));
          break;
        }
      }
    }
  }
  return phrases;
}

/** Names establish product references; ordinary fixture labels establish only
 * a room/item callout. Generic labels require an explicit, single-room heading. */
export function drawingNameEvidence(
  item: DrawingMatchItem,
  lines: string[],
  items: DrawingMatchItem[],
  roomVerified: boolean,
): {
  index: number;
  basis: "product_name" | "room_item";
  ambiguous?: boolean;
  words: string[];
} | null {
  const names = [
    item.name.split("|")[0],
    item.clientName || "",
    item.label,
    `${item.vendor} ${item.name.split("|")[0]}`,
  ]
    .map(drawingNameWords)
    .filter((words) => words.length >= 2);
  const windows = lines.map((_, index) =>
    drawingNameWords(lines.slice(index, index + 3).join(" ")),
  );
  for (const name of names) {
    const distinctive = [
      ...new Set(name.filter((word) => !ordinary.has(word) && word.length >= 3)),
    ];
    if (!distinctive.length) continue;
    const index = windows.findIndex(
      (words) =>
        (contains(words, name) && (distinctive.length >= 2 || roomVerified)) ||
        (distinctive.length >= 2 &&
          distinctive.every((word) => words.includes(word)) &&
          name.filter((word) => words.includes(word)).length / name.length >= 0.7),
    );
    if (index >= 0) return { index, basis: "product_name", words: distinctive };
  }
  if (!roomVerified) return null;
  for (const phrase of itemPhrases(item)) {
    // Distinctive names must pass the stronger product-name rules above.
    if (phrase.some((word) => !ordinary.has(word))) continue;
    const index = lines.findIndex((line) => {
      const words = drawingNameWords(line);
      if (!fixturePhraseAppears(words, phrase)) return false;
      // A toilet-paper holder is not evidence for the toilet; likewise sink
      // drains and shower drains are separate from the sink/shower fixture.
      return !/\b(existing|remove|demolish|optional|not used)\b/i.test(line);
    });
    if (index < 0) continue;
    const contenders = items.filter(
      (other) =>
        other.roomId === item.roomId &&
        itemPhrases(other).some((otherPhrase) => fixturePhraseAppears(otherPhrase, phrase)),
    );
    return { index, basis: "room_item", ambiguous: contenders.length !== 1, words: phrase };
  }
  return null;
}
