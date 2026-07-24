export type CartonCoverageConfidence = "exact" | "review" | "missing";

export interface CartonCoverageResult {
  squareFeet: number | null;
  confidence: CartonCoverageConfidence;
  evidence: string | null;
  candidates: number[];
}

const COVERAGE_PATTERNS = [
  /(?:sq(?:uare)?\.?\s*(?:feet|foot|ft)\.?\s*(?:per|\/)\s*(?:box|carton|case))\s*[:-]?\s*(\d+(?:\.\d+)?)/gi,
  /(?:coverage|covers?)\s*(?:per\s*)?(?:box|carton|case)?\s*[:-]?\s*(\d+(?:\.\d+)?)\s*(?:sq(?:uare)?\.?\s*(?:feet|foot|ft)\.?|sf)\b/gi,
  /(?:box|carton|case)\s*(?:coverage|quantity|contains?)\s*[:-]?\s*(\d+(?:\.\d+)?)\s*(?:sq(?:uare)?\.?\s*(?:feet|foot|ft)\.?|sf)\b/gi,
  /(\d+(?:\.\d+)?)\s*(?:sq(?:uare)?\.?\s*(?:feet|foot|ft)\.?|sf)\s*(?:per|\/)\s*(?:box|carton|case)\b/gi,
] as const;

function validCoverage(value: unknown) {
  const number =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .replace(/,/g, "")
            .trim(),
        );
  return Number.isFinite(number) && number >= 0.1 && number <= 1000 ? number : null;
}

function cleanEvidence(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedLabel(value: string) {
  return plainHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function dimensionKey(value: string) {
  const match = value.match(
    /(\d+(?:\.\d+)?)\s*(?:["'”’]|in(?:ch(?:es)?)?)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:["'”’]|in(?:ch(?:es)?)?)?/i,
  );
  return match ? `${Number(match[1])}x${Number(match[2])}` : "";
}

function packagingTableSections(html: string, sourceUrl: string, productName: string, sku: string) {
  const requestedLabels = new Set(
    [
      (() => {
        try {
          return decodeURIComponent(new URL(sourceUrl).hash.slice(1));
        } catch {
          return "";
        }
      })(),
      productName,
      sku,
    ]
      .map(normalizedLabel)
      .filter(Boolean),
  );
  const headings = Array.from(html.matchAll(/<h2\b[^>]*\bid=(["'])(.*?)\1[^>]*>[\s\S]*?<\/h2>/gi));
  const sections: string[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const id = normalizedLabel(decodeURIComponent(heading[2]));
    const label = normalizedLabel(heading[0]);
    if (!requestedLabels.has(id) && !requestedLabels.has(label)) continue;
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? html.length;
    sections.push(html.slice(start, end));
  }
  if (sections.length) return sections;
  const allTables = Array.from(html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)).map(
    (match) => match[0],
  );
  return allTables.length === 1 ? allTables : [];
}

export function resolveCartonCoverageTable(input: {
  html?: string | null;
  sourceUrl: string;
  productName: string;
  sku: string;
  size: string;
  color?: string;
}): CartonCoverageResult {
  const html = input.html ?? "";
  const requestedSize = dimensionKey(input.size);
  if (!html || !requestedSize) {
    return { squareFeet: null, confidence: "missing", evidence: null, candidates: [] };
  }

  const matches: Array<{
    itemId: string;
    size: string;
    pieces: string;
    coverage: number;
  }> = [];
  for (const section of packagingTableSections(
    html,
    input.sourceUrl,
    input.productName,
    input.sku,
  )) {
    for (const tableMatch of section.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
      const rows = tableMatch[1].split(/<tr\b[^>]*>/gi).filter((row) => /<(?:th|td)\b/i.test(row));
      const cells = (row: string) =>
        Array.from(row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)).map((match) =>
          plainHtml(match[1]),
        );
      const headers = cells(rows[0] ?? "").map(normalizedLabel);
      const itemIdIndex = headers.indexOf("itemid");
      const sizeIndex = headers.indexOf("size");
      const piecesIndex = headers.findIndex((header) => /pcsshtsbox|pcsbox/.test(header));
      const coverageIndex = headers.findIndex((header) => /sfbox|sqftbox/.test(header));
      if (sizeIndex < 0 || coverageIndex < 0) continue;

      for (const row of rows.slice(1)) {
        const rowCells = cells(row);
        if (dimensionKey(rowCells[sizeIndex] ?? "") !== requestedSize) continue;
        const coverage = validCoverage(rowCells[coverageIndex]);
        if (coverage === null) continue;
        matches.push({
          itemId: rowCells[itemIdIndex] ?? "",
          size: rowCells[sizeIndex] ?? input.size,
          pieces: rowCells[piecesIndex] ?? "",
          coverage,
        });
      }
    }
  }

  const normalizedColor = normalizedLabel(input.color ?? "");
  const colorMatches = normalizedColor
    ? matches.filter((match) => normalizedLabel(match.itemId).includes(normalizedColor))
    : [];
  const eligible = colorMatches.length ? colorMatches : matches;
  const candidates = Array.from(new Set(eligible.map((match) => match.coverage)));
  if (candidates.length !== 1) {
    return {
      squareFeet: null,
      confidence: candidates.length ? "review" : "missing",
      evidence: eligible[0]?.itemId ?? null,
      candidates,
    };
  }
  const matchedRow = eligible.find((match) => match.coverage === candidates[0])!;
  return {
    squareFeet: candidates[0],
    confidence: "exact",
    evidence: [
      matchedRow.itemId,
      matchedRow.size,
      matchedRow.pieces ? `${matchedRow.pieces} pcs/box` : "",
      `${matchedRow.coverage} sq ft/box`,
    ]
      .filter(Boolean)
      .join(" · "),
    candidates,
  };
}

export function parseCartonCoverageText(...values: Array<string | null | undefined>) {
  const candidates: Array<{ value: number; evidence: string }> = [];
  for (const raw of values) {
    if (!raw) continue;
    const text = raw.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
    for (const pattern of COVERAGE_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const value = validCoverage(match[1]);
        if (value === null) continue;
        const start = Math.max(0, (match.index ?? 0) - 60);
        const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 60);
        candidates.push({ value, evidence: cleanEvidence(text.slice(start, end)) });
      }
    }
  }
  const unique = Array.from(
    new Map(candidates.map((candidate) => [candidate.value, candidate] as const)).values(),
  );
  return unique;
}

export function resolveCartonCoverage(input: {
  extractedSquareFeet?: unknown;
  extractedEvidence?: unknown;
  pageText?: Array<string | null | undefined>;
}): CartonCoverageResult {
  const parsed = parseCartonCoverageText(...(input.pageText ?? []));
  const extracted = validCoverage(input.extractedSquareFeet);
  if (extracted !== null) {
    const evidence =
      typeof input.extractedEvidence === "string" && input.extractedEvidence.trim()
        ? cleanEvidence(input.extractedEvidence)
        : (parsed.find((candidate) => candidate.value === extracted)?.evidence ?? null);
    const values = Array.from(new Set([extracted, ...parsed.map((candidate) => candidate.value)]));
    return {
      squareFeet: values.length === 1 ? extracted : null,
      confidence: values.length === 1 ? "exact" : "review",
      evidence,
      candidates: values,
    };
  }
  if (parsed.length === 1) {
    return {
      squareFeet: parsed[0].value,
      confidence: "exact",
      evidence: parsed[0].evidence,
      candidates: [parsed[0].value],
    };
  }
  return {
    squareFeet: null,
    confidence: parsed.length > 1 ? "review" : "missing",
    evidence: parsed[0]?.evidence ?? null,
    candidates: parsed.map((candidate) => candidate.value),
  };
}

export function packagingDocumentUrls(
  sourceUrl: string,
  ...pageValues: Array<string | null | undefined>
) {
  const found = new Set<string>();
  const linkPattern = /(?:href=["']|\]\()([^"' )>]+)(?:["']|\))/gi;
  for (const pageValue of pageValues) {
    if (!pageValue) continue;
    for (const match of pageValue.matchAll(linkPattern)) {
      const href = match[1];
      const context = pageValue.slice(
        Math.max(0, (match.index ?? 0) - 100),
        Math.min(pageValue.length, (match.index ?? 0) + match[0].length + 100),
      );
      if (!/packag|carton|box\s+(?:details|spec)|thickness/i.test(context)) continue;
      try {
        const url = new URL(href.replace(/&amp;/g, "&"), sourceUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") continue;
        found.add(url.toString());
      } catch {
        // Ignore malformed links and keep the product page as the manual source.
      }
    }
  }
  return Array.from(found).slice(0, 2);
}
