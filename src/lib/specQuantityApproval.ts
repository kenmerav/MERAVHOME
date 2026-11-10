import { quantityReviewEligible, type DrawingMatchItem, type DrawingMatchReport } from "./specDrawingMatches";

// Treat a scan as evidence only when every page and every group completed.
// A partial elevation is a lower bound, never an approved room total.
export function approvableDrawingQuantity(report: DrawingMatchReport, item: DrawingMatchItem) {
  if (report.status !== "complete" || !Number.isSafeInteger(report.totalPages) || report.totalPages < 1 ||
    report.reviewedPages.length !== report.totalPages || new Set(report.reviewedPages).size !== report.totalPages ||
    report.reviewedPages.some(page => !Number.isInteger(page) || page < 1 || page > report.totalPages) ||
    !report.totalChunks || report.completedChunks !== report.totalChunks || item.quantityUnit !== "count" ||
    !item.productId || !item.materialUpdatedAt ||
    !quantityReviewEligible({ category: item.category, item_label: item.label, product: { name: item.name } })) return null;
  const matches = (report.quantityFindings || []).filter(row => row.itemId === item.id);
  if (matches.length !== 1) return null;
  const finding = matches[0];
  if (finding.status !== "suggested" || !Number.isSafeInteger(finding.quantity) || !finding.quantity || finding.quantity < 1 ||
    !finding.sources.length || !finding.sources.some(source => source.source === "schedule" || source.source === "layout") ||
    finding.sources.some(source => source.itemId !== item.id || source.room !== item.room || !source.evidence ||
      !Number.isInteger(source.page) || source.page < 1 || source.page > report.totalPages ||
      (source.source !== "layout_minimum" && source.quantity !== finding.quantity) ||
      (source.source === "layout_minimum" && source.quantity > finding.quantity!))) return null;
  const current = item.quantityTbd ? "TBD" : item.quantity == null ? "Not set" : String(item.quantity);
  if (finding.current !== current) return null;
  return finding.quantity;
}
