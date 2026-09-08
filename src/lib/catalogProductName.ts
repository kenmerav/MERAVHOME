export const CATALOG_NAME_PENDING_NOTE = "Catalog name pending product scrape.";

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTemporaryCatalogProductName(
  name: string | null | undefined,
  notes?: string | null,
) {
  const normalized = normalize(name);
  if (!normalized || notes?.includes(CATALOG_NAME_PENDING_NOTE)) return true;
  if (["untitled product", "imported product", "product details pending"].includes(normalized)) {
    return true;
  }
  const startsWithRoom =
    /^(kitchen|dining room|living room|great room|primary bathroom|powder bathroom|bedroom|pantry|laundry room|mudroom|foyer|entry|hallway|closet)\b/.test(
      normalized,
    );
  const describesProjectUse =
    /\b(all over|finish|paint color|door hardware|wall treatment|ceiling finish|baseboard|casing)\b/.test(
      normalized,
    );
  if (startsWithRoom && describesProjectUse) {
    return true;
  }
  return /^(wall finish|wall treatment|ceiling finish|ceiling paint|flooring|baseboard|casing|doors?|door hardware|cabinet hardware|countertop|backsplash|paint color|all over paint color)$/.test(
    normalized,
  );
}

export function shouldReplaceCatalogProductName({
  existingName,
  scrapedName,
  itemLabel,
  clientProductName,
  notes,
}: {
  existingName: string | null | undefined;
  scrapedName: string | null | undefined;
  itemLabel?: string | null;
  clientProductName?: string | null;
  notes?: string | null;
}) {
  const current = normalize(existingName);
  const scraped = normalize(scrapedName);
  if (!scraped || scraped === current) return false;
  if (isTemporaryCatalogProductName(existingName, notes)) return true;
  return [itemLabel, clientProductName].some((value) => normalize(value) === current);
}
