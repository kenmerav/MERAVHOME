export type ConstructionDocumentFinalityEvidence = {
  source: "filename" | "email" | "pdf" | "history";
  text: string;
  page?: number;
};

export type ConstructionDocumentFinality = {
  estimate: "likely_final" | "likely_not_final" | "unclear";
  confidence: "high" | "medium" | "low";
  reason: string;
  evidence: ConstructionDocumentFinalityEvidence[];
  revision: string | null;
  documentDate: string | null;
};

export type ConstructionDocumentFinalityInput = {
  fileName?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  emailThread?: string | null;
  pdfPages?: Array<{ page: number; text: string }>;
};

const NOT_FINAL_PATTERN =
  /\b(?:not\s+final|not\s+for\s+construction|draft|preliminary|progress\s+(?:set|print)|for\s+review|review\s+set|redlines?|markups?|schematic|concept(?:ual)?|working\s+set|bid\s+set|pricing\s+set|\d{2}\s*%\s*(?:set|complete|documents?|drawings?))\b/i;
const FINAL_PATTERN =
  /\b(?:final(?:\s+(?:set|documents?|drawings?|plans?|construction\s+documents?))?|issued\s+for\s+construction|ifc(?:\s+set)?|permit\s+set|signed\s+and\s+sealed|record\s+set|as[-\s]?built)\b/i;
const REVISION_PATTERN = /\b(?:rev(?:ision)?)\s*[:#.-]?\s*([A-Z0-9]{1,8})\b/i;

function classifyText(value: string) {
  const notFinal = NOT_FINAL_PATTERN.test(value);
  const final = FINAL_PATTERN.test(value);
  if (notFinal) return "likely_not_final" as const;
  if (final) return "likely_final" as const;
  return null;
}

function evidenceSnippet(value: string, pattern: RegExp) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const matching = lines.find((line) => pattern.test(line));
  if (!matching) return value.replace(/\s+/g, " ").trim().slice(0, 240);
  return matching.length > 280 ? `${matching.slice(0, 277).trimEnd()}...` : matching;
}

function evidenceFor(
  source: ConstructionDocumentFinalityEvidence["source"],
  value: string,
  page?: number,
) {
  const classification = classifyText(value);
  if (!classification) return [];
  const pattern = classification === "likely_final" ? FINAL_PATTERN : NOT_FINAL_PATTERN;
  return [{ source, text: evidenceSnippet(value, pattern), ...(page ? { page } : {}) }];
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractDocumentDate(value: string) {
  const fourDigit = value.match(/\b(20\d{2})[-_./]([01]?\d)[-_./]([0-3]?\d)\b/);
  if (fourDigit)
    return validIsoDate(Number(fourDigit[1]), Number(fourDigit[2]), Number(fourDigit[3]));

  const compact = value.match(/(?:^|\D)(\d{2})([01]\d)([0-3]\d)(?:\D|$)/);
  if (compact)
    return validIsoDate(2000 + Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const labeled = value.match(
    /\b(?:date|issued)\s*[:#.-]?\s*([01]?\d)[/-]([0-3]?\d)[/-](20\d{2}|\d{2})\b/i,
  );
  if (!labeled) return null;
  const year = Number(labeled[3]) < 100 ? 2000 + Number(labeled[3]) : Number(labeled[3]);
  return validIsoDate(year, Number(labeled[1]), Number(labeled[2]));
}

function extractRevision(value: string) {
  return value.match(REVISION_PATTERN)?.[1]?.toUpperCase() || null;
}

export function estimateConstructionDocumentFinality(
  input: ConstructionDocumentFinalityInput,
): ConstructionDocumentFinality {
  const fileName = String(input.fileName || "").replace(/[_-]+/g, " ");
  const currentEmail = `${input.emailSubject || ""}\n${input.emailBody || ""}`.trim();
  const pdfPages = input.pdfPages ?? [];
  const pdfText = pdfPages.map((page) => page.text).join("\n");
  const primarySignals = [fileName, currentEmail, pdfText].filter(Boolean);
  const primaryClassifications = primarySignals.map(classifyText).filter(Boolean);
  const hasFinal = primaryClassifications.includes("likely_final");
  const hasNotFinal = primaryClassifications.includes("likely_not_final");
  const hasConflict = hasFinal && hasNotFinal;

  const evidence = [
    ...evidenceFor("filename", fileName),
    ...evidenceFor("email", currentEmail),
    ...pdfPages.flatMap((page) => evidenceFor("pdf", page.text, page.page)),
  ].slice(0, 8);
  const metadataText = `${fileName}\n${pdfText}\n${currentEmail}`;
  const revision = extractRevision(metadataText);
  const documentDate = extractDocumentDate(metadataText);

  if (hasConflict) {
    return {
      estimate: "unclear",
      confidence: "medium",
      reason:
        "The filename, current email, or PDF contains conflicting final and in-progress wording.",
      evidence,
      revision,
      documentDate,
    };
  }

  if (hasNotFinal || hasFinal) {
    const estimate = hasNotFinal ? "likely_not_final" : "likely_final";
    const strongSource = Boolean(classifyText(fileName) || classifyText(pdfText));
    return {
      estimate,
      confidence: strongSource ? "high" : "medium",
      reason:
        estimate === "likely_not_final"
          ? "The attachment, current email, or PDF identifies this as a draft, review, preliminary, or progress set."
          : "The attachment, current email, or PDF explicitly identifies this as final or issued for construction.",
      evidence,
      revision,
      documentDate,
    };
  }

  const thread = String(input.emailThread || "");
  const threadEstimate = classifyText(thread);
  const threadEvidence = evidenceFor("history", thread);
  if (threadEstimate) {
    return {
      estimate: threadEstimate,
      confidence: "low",
      reason:
        threadEstimate === "likely_final"
          ? "An earlier message in the email thread uses final-set wording, but the current email and PDF do not confirm it."
          : "An earlier message in the email thread uses draft or review wording, but the current email and PDF do not confirm it.",
      evidence: threadEvidence,
      revision: revision || extractRevision(thread),
      documentDate: documentDate || extractDocumentDate(thread),
    };
  }

  return {
    estimate: "unclear",
    confidence: "low",
    reason:
      input.emailSubject || input.emailBody || input.emailThread || pdfText
        ? "The attachment, email, and readable PDF text do not clearly say whether this is the final set."
        : "No email context, readable PDF text, or clear final/draft wording was available.",
    evidence: [],
    revision,
    documentDate,
  };
}

export function constructionDocumentFamilyKey(value: string | null | undefined) {
  return String(value || "")
    .replace(/\.pdf$/i, "")
    .replace(/\b(?:final|draft|preliminary|review|ifc|permit|set|rev(?:ision)?)\b/gi, " ")
    .replace(/(?:^|\D)\d{6,8}(?:\D|$)/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

type ConstructionDocumentVersionInfo = {
  fileName?: string | null;
  revision?: string | null;
  documentDate?: string | null;
};

function versionMetadata(value: ConstructionDocumentVersionInfo) {
  const fileName = String(value.fileName || "");
  return {
    revision: value.revision || extractRevision(fileName),
    documentDate: value.documentDate || extractDocumentDate(fileName),
  };
}

export function isConstructionDocumentVersionLater(
  current: ConstructionDocumentVersionInfo,
  candidate: ConstructionDocumentVersionInfo,
) {
  const currentVersion = versionMetadata(current);
  const candidateVersion = versionMetadata(candidate);

  if (currentVersion.documentDate && candidateVersion.documentDate) {
    if (currentVersion.documentDate !== candidateVersion.documentDate) {
      return currentVersion.documentDate > candidateVersion.documentDate;
    }
  }

  if (currentVersion.revision && candidateVersion.revision) {
    return (
      currentVersion.revision.localeCompare(candidateVersion.revision, undefined, {
        numeric: true,
        sensitivity: "base",
      }) > 0
    );
  }

  return false;
}
