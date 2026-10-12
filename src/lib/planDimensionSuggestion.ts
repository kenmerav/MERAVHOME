export type PlanDimensionSuggestion = {
  status: "suggested" | "not_found" | "unavailable";
  dimensions: string;
  dimension_scope: "proposed_layout" | "product_specification" | null;
  document: { id: string; title: string } | null;
  page: number | null; sheet: string; evidence: string; message: string;
};
