export type ExtractedMaterialPdfItem = {
  room_name: string;
  item_label: string;
  product_url: string;
  quantity: number | null;
  color: string | null;
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function decodePdfLiteral(value: string) {
  return value
    .replace(/\\([\\()nrtbf])/g, (_, escaped) => {
      if (escaped === "n") return "\n";
      if (escaped === "r") return "\r";
      if (escaped === "t") return "\t";
      if (escaped === "b") return "\b";
      if (escaped === "f") return "\f";
      return escaped;
    })
    .trim();
}

function pickRoomNameFromText(text: string) {
  for (const match of text.matchAll(/\/E\s*\(([^)]{2,120})\)/g)) {
    const heading = decodePdfLiteral(match[1]);
    if (!/(fixture|finish|material|selection)/i.test(heading)) continue;
    if (/materials list/i.test(heading) || /^\d+\./.test(heading.trim())) continue;
    const roomName = heading.replace(/\s*(?:fixtures?|finishes|materials?|selections?).*$/i, "").trim();
    if (roomName) return titleCase(roomName);
  }

  const taggedHeadings = Array.from(text.matchAll(/\/E\s*\(([^)]{2,120})\)/g)).map((match) =>
    decodePdfLiteral(match[1]),
  );
  const materialsListIndex = taggedHeadings.findIndex((heading) => /materials list/i.test(heading));
  if (materialsListIndex > 0) {
    const previousHeading = taggedHeadings[materialsListIndex - 1].trim();
    const looksLikeRoomName =
      previousHeading.length <= 40 &&
      !/^\d+\./.test(previousHeading) &&
      !/[|:]/.test(previousHeading) &&
      !/https?:\/\//i.test(previousHeading);
    if (looksLikeRoomName) return titleCase(previousHeading);
  }

  const outlineTitleMatch = text.match(/\/Title\s*\(([^)]{2,80})\)[\s\S]{0,120}?\/Dest\s*\[/);
  const titleMatch = text.match(/\/Title\s*\(([^)]{2,80})\)/);
  const taggedTitleMatch = text.match(/\/T\s*\(([^)]{2,80})\)/);
  return titleCase(outlineTitleMatch?.[1] || titleMatch?.[1] || taggedTitleMatch?.[1] || "Imported Room");
}

function roomNameFromSectionHeading(value: string) {
  const heading = value.replace(/\\+$/g, "").trim();
  const normalized = normalize(heading);
  if (!normalized) return null;
  if (/materials throughout/.test(normalized)) return "Materials Throughout";
  if (/appliances throughout/.test(normalized)) return "Appliances Throughout";

  const fixturesMatch = heading.match(/^(.+?)\s+(?:fixtures?|finishes|materials?|selections?)\s*(?:\+\s*finishes)?(?:\s+option\s+[a-z])?\s*:?\s*$/i);
  if (fixturesMatch?.[1]) return titleCase(fixturesMatch[1].trim());
  return null;
}

function extractActionUrls(rawPdf: string) {
  const actionUrls = new Map<string, string>();
  for (const objectBlock of rawPdf.split(/\bendobj/)) {
    if (!objectBlock.includes("/S /URI")) continue;
    const objectId = objectBlock.match(/(\d+)\s+0\s+obj/)?.[1];
    const uri = objectBlock.match(/\/URI\s*\(([\s\S]*?)\)/)?.[1];
    if (objectId && uri) actionUrls.set(objectId, decodePdfLiteral(uri));
  }
  return actionUrls;
}

function extractTaggedLabels(rawPdf: string) {
  return Array.from(rawPdf.matchAll(/\/E\s*\(([^)]{2,160})\)/g)).map((match) => decodePdfLiteral(match[1]));
}

function isLikelyItemHeading(value: string) {
  const label = cleanItemLabel(value);
  const n = normalize(label);
  if (!n || n.length < 2) return false;
  if (/^https?:\/\//i.test(label)) return false;
  if (/^low(er)?$|^upp(er)?$/.test(n)) return false;
  if (/materials list/.test(n)) return false;
  return true;
}

function buildTaggedItemQueue(rawPdf: string) {
  const queue: Array<{ roomName: string; label: string; used: boolean }> = [];
  let currentRoom = pickRoomNameFromText(rawPdf);

  for (const taggedLabel of extractTaggedLabels(rawPdf)) {
    const sectionRoom = roomNameFromSectionHeading(taggedLabel);
    if (sectionRoom) {
      currentRoom = sectionRoom;
      continue;
    }
    if (!isLikelyItemHeading(taggedLabel)) continue;
    queue.push({ roomName: currentRoom, label: taggedLabel, used: false });
  }

  return queue;
}

function labelsMatch(left: string, right: string) {
  const a = normalize(cleanItemLabel(left));
  const b = normalize(cleanItemLabel(right));
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function nextTaggedItemForLink(label: string, taggedItems: Array<{ roomName: string; label: string; used: boolean }>) {
  const searchStart = taggedItems.findIndex((item) => !item.used);
  if (searchStart === -1) return null;

  if (label && !isUrlLabel(label)) {
    const matchedIndex = taggedItems.findIndex((item, index) => index >= searchStart && !item.used && labelsMatch(label, item.label));
    if (matchedIndex !== -1) {
      taggedItems[matchedIndex].used = true;
      return taggedItems[matchedIndex];
    }
  }

  const nextItem = taggedItems[searchStart];
  nextItem.used = true;
  return nextItem;
}

function isUrlLabel(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function cleanItemLabel(value: string) {
  return value
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/\bHARWARE\b/gi, "HARDWARE")
    .split(/\s+\|\s+/)[0]
    .split(/\s+I\s+(?:QTY|QUANTITY)\s*:/i)[0]
    .trim();
}

function enrichTruncatedLabel(label: string, taggedLabels: string[]) {
  const labelKey = normalize(cleanItemLabel(label));
  if (!labelKey) return label;
  const fullLabel = taggedLabels.find((taggedLabel) => normalize(cleanItemLabel(taggedLabel)) === labelKey);
  if (!fullLabel) return label;

  const labelHasQuantity = /\b(?:QTY|QUANTITY)\s*:\s*\d/i.test(label);
  const fullHasQuantity = /\b(?:QTY|QUANTITY)\s*:\s*\d/i.test(fullLabel);
  const labelHasFinish = /\bFINISH\s*:\s*\S/i.test(label);
  const fullHasFinish = /\bFINISH\s*:\s*\S/i.test(fullLabel);
  return (!labelHasQuantity && fullHasQuantity) || (!labelHasFinish && fullHasFinish) ? fullLabel : label;
}

function extractQuantity(value: string) {
  const match = value.match(/\b(?:QTY|QUANTITY)\s*:\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function extractColor(value: string) {
  const match = value.match(/\bFINISH\s*:\s*(.+?)(?:\s+I\s+(?:QTY|QUANTITY|SIZE)\b|\s+\|\s*(?:QTY|QUANTITY|SIZE)\b|$)/i);
  return match?.[1] ? titleCase(match[1].trim()) : null;
}

function parsePdfItem(label: string, roomName: string, productUrl: string): ExtractedMaterialPdfItem | null {
  if (isUrlLabel(label) || normalize(label) === normalize(roomName)) return null;
  const itemLabel = cleanItemLabel(label);
  if (!itemLabel) return null;
  return {
    room_name: roomName,
    item_label: titleCase(itemLabel),
    product_url: productUrl,
    quantity: extractQuantity(label),
    color: extractColor(label),
  };
}

function fallbackLabelFromUrl(productUrl: string) {
  let url: URL;
  try {
    url = new URL(productUrl);
  } catch {
    return "Imported Material";
  }

  const hostAndPath = `${url.hostname} ${url.pathname}`.toLowerCase();
  if (/rangehood|range-hood|stove-hood/.test(hostAndPath)) return "Range Hood";
  if (/sconce/.test(hostAndPath)) return "Sconce";
  if (/pendant/.test(hostAndPath)) return "Pendant";
  if (/zellige|tile/.test(hostAndPath)) return "Tile";
  if (/quartzite|counter|slab/.test(hostAndPath)) return "Countertop";
  if (/sink|blanco/.test(hostAndPath)) return "Sink";
  if (/pot-filler/.test(hostAndPath)) return "Pot Filler";
  if (/faucet/.test(hostAndPath)) return "Faucet";
  if (/top-knobs|knob|pull/.test(hostAndPath)) return "Cabinet Hardware";
  if (/cabinet|sollid/.test(hostAndPath)) return "Cabinet Finish";

  const slug = url.pathname.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ");
  return slug ? titleCase(slug) : titleCase(url.hostname.replace(/^www\./, ""));
}

export function extractMaterialPdfItemsFromText(rawPdf: string): ExtractedMaterialPdfItem[] {
  const actionUrls = extractActionUrls(rawPdf);
  const taggedLabels = extractTaggedLabels(rawPdf);
  const taggedItems = buildTaggedItemQueue(rawPdf);
  const fallbackRoomName = pickRoomNameFromText(rawPdf);
  const imported: ExtractedMaterialPdfItem[] = [];
  const seen = new Set<string>();
  const usedUrls = new Set<string>();
  const urlOnlyAnnotations = new Set<string>();

  for (const annotation of rawPdf.split(/\bendobj/)) {
    if (!annotation.includes("/Subtype /Link")) continue;
    const actionRef = annotation.match(/\/A\s+(\d+)\s+0\s+R/)?.[1];
    const labelValue = annotation.match(/\/Contents\s*\(([\s\S]*?)\)/)?.[1];
    const url = actionRef ? actionUrls.get(actionRef) : null;
    const label = labelValue ? decodePdfLiteral(labelValue) : "";
    if (!url || !label) continue;

    const taggedItem = nextTaggedItemForLink(label, taggedItems);
    const roomName = taggedItem?.roomName || fallbackRoomName;
    const enrichedLabel = taggedItem?.label || enrichTruncatedLabel(label, taggedLabels);
    const item = parsePdfItem(enrichedLabel, roomName, url);
    if (!item) {
      if (isUrlLabel(label)) urlOnlyAnnotations.add(url);
      continue;
    }
    const key = `${normalize(item.room_name)}::${normalize(item.item_label)}::${item.product_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    usedUrls.add(item.product_url);
    imported.push(item);
  }

  for (const url of urlOnlyAnnotations) {
    if (usedUrls.has(url)) continue;
    const taggedItem = nextTaggedItemForLink("", taggedItems);
    const roomName = taggedItem?.roomName || fallbackRoomName;
    const item = {
      room_name: roomName,
      item_label: taggedItem?.label ? titleCase(cleanItemLabel(taggedItem.label)) : fallbackLabelFromUrl(url),
      product_url: url,
      quantity: 1,
      color: null,
    };
    const key = `${normalize(item.room_name)}::${normalize(item.item_label)}::${item.product_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imported.push(item);
  }

  return imported;
}

export async function extractMaterialPdfItemsFromFile(file: File) {
  const rawPdf = new TextDecoder("latin1").decode(await file.arrayBuffer());
  return extractMaterialPdfItemsFromText(rawPdf);
}
