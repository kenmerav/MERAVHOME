import type { MaterialItem } from "./db";
import type { CompletionFinding } from "./specCompletion";

export const FINISH_REVIEW_VERSION = 1;
export type SelectedFinishEvidence = {
  status: "verified" | "unverified";
  color: string;
  finish: string;
  basis: "url_variant" | "single_finish" | "unconfirmed";
  evidence: string;
};
export type FinishObservation = SelectedFinishEvidence & {
  item_id: string;
  source_url: string;
  checked_at: string;
};
export type FinishReview = {
  version: number;
  checked_at: string;
  verified_count: number;
  review_count: number;
  observations: FinishObservation[];
};

export function ambiguousFinish(value: unknown) {
  return (
    typeof value === "string" &&
    /\b(?:or|either|undecided|options?|available in|choose|select|tbd|tbc|unknown|not selected|to be confirmed)\b|\?/i.test(
      value,
    )
  );
}

const clean = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 500) : "");
const pageText = (value: unknown) => clean(value).toLowerCase().replace(/\s+/g, " ");
function normalizedFinish(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(?:colou?r|finish|colorway|two[ -]tone|multicolou?r|with|and|accents?)\b/g, " ")
    .replace(/grey/g, "gray")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index, words) => words.indexOf(word) === index)
    .sort();
}
export function finishMatches(current: string, selected: string) {
  const a = normalizedFinish(current),
    b = normalizedFinish(selected);
  if (!a.length || !b.length) return false;
  // A treatment alone is often stored separately from the selected color.
  const treatments = new Set([
    "matte",
    "flat",
    "eggshell",
    "satin",
    "polished",
    "brushed",
    "honed",
    "gloss",
    "glossy",
  ]);
  const colorsA = a.filter((word) => !treatments.has(word));
  const colorsB = b.filter((word) => !treatments.has(word));
  return (
    JSON.stringify(colorsA.length ? colorsA : a) === JSON.stringify(colorsB.length ? colorsB : b)
  );
}
export function selectedFinishLabel(evidence: SelectedFinishEvidence) {
  const values = [evidence.color, evidence.finish].filter(Boolean);
  if (values.length === 2 && values[1].toLowerCase().includes(values[0].toLowerCase()))
    return values[1];
  return [...new Set(values)].join(" / ");
}

/** Only structured selected-option evidence can establish the URL's finish.
 * Saved selections, thumbnails, product titles and a list of options are not evidence. */
export function finishEvidenceFromPage(value: unknown, sourceUrl: string): SelectedFinishEvidence {
  const data = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const extracted = data.json ?? data.extract ?? {};
  const color = clean(extracted.selected_color),
    finish = clean(extracted.selected_finish);
  const evidence = clean(extracted.selected_finish_evidence);
  const basis = extracted.selected_finish_basis;
  const rawPage = [data.markdown, data.rawHtml, data.html]
    .filter((v) => typeof v === "string")
    .join(" ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ");
  const unsupported = (): SelectedFinishEvidence => ({
    status: "unverified",
    color: "",
    finish: "",
    basis: "unconfirmed",
    evidence: "The product link did not establish an exact selected color / finish.",
  });
  if (
    (!color && !finish) ||
    ambiguousFinish(color) ||
    ambiguousFinish(finish) ||
    /\bor\b/i.test(evidence) ||
    !evidence ||
    !rawPage.includes(pageText(evidence)) ||
    ![color, finish].filter(Boolean).every((v) => pageText(evidence).includes(pageText(v)))
  )
    return unsupported();
  if (basis === "single_finish") {
    const choices = Array.isArray(extracted.finish_options)
      ? extracted.finish_options.filter((v: unknown) => typeof v === "string" && v.trim())
      : [];
    if (
      choices.length !== 1 ||
      !finishMatches(selectedFinishLabel({ color, finish } as SelectedFinishEvidence), choices[0])
    )
      return unsupported();
  } else if (basis === "url_variant") {
    const id = clean(extracted.selected_variant_id);
    try {
      const url = new URL(sourceUrl);
      const identifiers = [...url.searchParams.entries()]
        .filter(([key]) =>
          /^(?:(?:variant|sku|product|finish|colou?r|option)_?id|variant|sku|pid|piid|selected_?sku|finish|colou?r|colorway|option)$/i.test(
            key,
          ),
        )
        .map(([, v]) => v);
      identifiers.push(...decodeURIComponent(url.pathname).split("/"));
      if (
        id.length < 3 ||
        !identifiers.some((v) => v.toLowerCase() === id.toLowerCase()) ||
        !pageText(evidence).includes(id.toLowerCase())
      )
        return unsupported();
    } catch {
      return unsupported();
    }
  } else return unsupported();
  return { status: "verified", color, finish, basis, evidence };
}

export function shopifyFinishEvidence(
  product: {
    options?: Array<string | { name?: string }>;
    variants?: Array<{ id?: string | number; options?: string[] }>;
  },
  selectedId: string | null,
): SelectedFinishEvidence {
  const variants = product.variants ?? [];
  const index = (pattern: RegExp) =>
    product.options?.findIndex((option) =>
      pattern.test(typeof option === "string" ? option : option.name || ""),
    ) ?? -1;
  const colorIndex = index(/colou?r|colorway/i),
    finishIndex = index(/finish|surface|treatment/i);
  const details = (variant: (typeof variants)[number]) => ({
    color: clean(variant.options?.[colorIndex]),
    finish: clean(variant.options?.[finishIndex]),
  });
  const selected = variants.find((variant) => String(variant.id) === selectedId);
  const choices = variants.map(details);
  const oneFinish =
    choices.length > 0 &&
    choices.every(
      (choice) =>
        (choice.color || choice.finish) &&
        !ambiguousFinish(choice.color) &&
        !ambiguousFinish(choice.finish) &&
        JSON.stringify(choice) === JSON.stringify(choices[0]),
    );
  const current = selected ? details(selected) : !selectedId && oneFinish ? choices[0] : null;
  if (
    !current ||
    (!current.color && !current.finish) ||
    ambiguousFinish(current.color) ||
    ambiguousFinish(current.finish)
  )
    return {
      status: "unverified",
      color: "",
      finish: "",
      basis: "unconfirmed",
      evidence:
        "The link does not select an exact finish; multiple or unresolved product options remain.",
    };
  return {
    ...current,
    status: "verified",
    basis: selected ? "url_variant" : "single_finish",
    evidence: `${selected ? `URL-selected variant ${selectedId}` : "All published variants share this finish"}: ${[current.color, current.finish].filter(Boolean).join(" / ")}.`,
  };
}

export function mergeFinishEvidence(a?: SelectedFinishEvidence, b?: SelectedFinishEvidence) {
  if (
    a?.status === "verified" &&
    b?.status === "verified" &&
    !finishMatches(selectedFinishLabel(a), selectedFinishLabel(b))
  )
    return {
      status: "unverified",
      color: "",
      finish: "",
      basis: "unconfirmed",
      evidence:
        "Product page sources disagree about the selected finish. Confirm the variant on the link.",
    } satisfies SelectedFinishEvidence;
  return a?.status === "verified" ? a : (b ?? a);
}

export function reviewSelectedFinishes(items: MaterialItem[], observations: FinishObservation[]) {
  const findings: CompletionFinding[] = [];
  let verified = 0;
  for (const item of items) {
    const url = item.product_url?.trim() || item.product?.product_url?.trim() || "";
    if (!/^https?:\/\//i.test(url)) continue; // The existing link check handles missing/invalid links.
    const observed = observations.find((row) => row.item_id === item.id && row.source_url === url);
    const current = item.color?.trim() || item.product?.finish?.trim() || "";
    const linkedFinish = observed?.status === "verified" ? selectedFinishLabel(observed) : "";
    const selected = /^(?:(?:matte|flat|eggshell|satin|polished|brushed|honed|glossy?|smooth|textured|unfinished|silgranit|roman clay)[\s/,-]*)+$/i.test(linkedFinish) ? "" : linkedFinish;
    const ambiguous = ambiguousFinish(current);
    if (!ambiguous && selected && finishMatches(current, selected)) {
      verified++;
      continue;
    }
    findings.push({
      id: `${item.id}:color`,
      room_id: item.room_id,
      item_id: item.id,
      item_label: item.client_product_name || item.item_label,
      field: "color",
      source: "details",
      message: ambiguous
        ? "Color / finish lists alternatives. Confirm the selected finish from the product link."
        : selected
          ? "Saved color / finish does not match the selected variant on the product link."
          : "The selected color / finish could not be verified from the product link.",
      current,
      suggested: selected,
      page: null,
      sheet: "",
      evidence:
        observed?.evidence || "No current selected-variant evidence was returned for this link.",
      finish_check: ambiguous ? "ambiguous" : selected ? "mismatch" : "unverified",
    });
  }
  return { findings, verified_count: verified, review_count: findings.length };
}
