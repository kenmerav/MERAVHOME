const CONSTRUCTION_DOCUMENT_TERMS =
  /\b(construction|drawing|drawings|plan|plans|sheet|sheets|elevation|elevations|detail|details|specification|specifications|blueprint|blueprints|cad|autocad|architect|architecture|mep|electrical|plumbing|mechanical|ceiling|riser|dimension|dimensions|floor plan|reflected ceiling|rcp|wall|cabinet|cabinetry|millwork|fixture|fixtures|sconce|outlet|switch|tile|finish|location|height|width|depth|aff|clearance|installation|door|window|lighting|hardware|square feet|square foot|sq\.?\s*ft\.?|square footage|floor area|room size|room sizes)\b/i;

/**
 * Decide whether a question needs page-level construction-document inspection instead of
 * ordinary text retrieval. Keep this intentionally broad: visual drawing facts are frequently
 * labels, dimensions, or geometry that never make it into a PDF text index.
 */
export function isConstructionDocumentQuestion(...values: unknown[]) {
  return CONSTRUCTION_DOCUMENT_TERMS.test(
    values
      .map((value) => String(value || ""))
      .join(" ")
      .trim(),
  );
}
