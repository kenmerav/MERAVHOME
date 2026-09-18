export const PROJECT_ACCESS_FIELDS = [
  "client_can_view_spec_book",
  "client_can_view_presentations",
  "client_can_view_design_boards",
  "client_can_download_design_board_pdf",
  "client_can_view_construction_docs",
  "client_can_download_construction_docs",
  "client_can_download_spec_book_pdf",
  "client_spec_show_pricing",
  "client_spec_show_links",
  "client_spec_show_ordering",
  "contractor_can_view_spec_book",
  "contractor_can_view_presentations",
  "contractor_can_view_design_boards",
  "contractor_can_download_design_board_pdf",
  "contractor_can_view_construction_docs",
  "contractor_can_download_spec_book_pdf",
  "contractor_spec_show_pricing",
  "contractor_spec_show_links",
  "contractor_spec_show_ordering",
  "contractor_spec_can_update_ordering",
] as const;

export type ProjectAccessSettings = Record<(typeof PROJECT_ACCESS_FIELDS)[number], boolean>;

export function parseProjectAccessSettings(value: unknown): ProjectAccessSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = new Set<string>(PROJECT_ACCESS_FIELDS);
  if (Object.keys(input).length !== PROJECT_ACCESS_FIELDS.length) return null;
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;
  if (PROJECT_ACCESS_FIELDS.some((key) => typeof input[key] !== "boolean")) return null;
  return input as ProjectAccessSettings;
}
