export const EA_VENDOR_SHEET_ID = "15m_YO1zSbxuJcacuXKaY6HB81dTlmY79kMCESH1y_ms";
export const EA_VENDOR_SHEET_TAB_ID = "0";

export type EaVerificationStatus = "verified" | "needs_verification" | "archived";

export type EaContact = {
  id: string;
  contact_kind: "merav_team" | "client" | "builder_trade_consultant" | "vendor_rep" | "partner";
  name: string;
  company: string | null;
  general_role: string | null;
  email: string | null;
  phone: string | null;
  preferred_communication: string | null;
  internal_notes: string | null;
  verification_status: EaVerificationStatus;
  source_type: string | null;
  source_reference: string | null;
  last_verified_at: string | null;
};

export type EaVendorProfile = {
  id: string;
  supplier_company: string;
  brand_or_manufacturer: string | null;
  ordering_method: string | null;
  categories: string[];
  brands_supplied: string[];
  purchasing_instructions: string | null;
  purchasing_route_status: "confirmed" | "confirm_route" | "needs_verification" | "archived";
  contact_verification_status: EaVerificationStatus;
  source_type: string | null;
  source_reference: string | null;
  last_verified_at: string | null;
  primary_sales_contact_id: string | null;
  service_contact_id: string | null;
  primary_sales_contact?: EaContact | null;
  service_contact?: EaContact | null;
};

export type SafeVendorImportRow = {
  source_row_number: number;
  vendor: string;
  category?: string | null;
  rep_name?: string | null;
  rep_email?: string | null;
};

const CATEGORY_HEADERS = new Set([
  "hard scape vendors",
  "wallcovering",
  "lighting",
  "cabinet hardware",
  "furnishings (trade)",
]);

export function normalizeList(value: unknown) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(values.map((entry) => String(entry).trim()).filter(Boolean))).slice(
    0,
    30,
  );
}

export function cleanSafeImportRows(rows: unknown): SafeVendorImportRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, 1000)
    .map((row) => {
      const candidate = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        source_row_number: Math.max(1, Math.trunc(Number(candidate.source_row_number) || 0)),
        vendor: clean(candidate.vendor, 160),
        category: nullable(candidate.category, 100),
        rep_name: nullable(candidate.rep_name, 160),
        rep_email: validEmail(candidate.rep_email)
          ? clean(candidate.rep_email, 240).toLowerCase()
          : null,
      };
    })
    .filter((row) => row.vendor && !CATEGORY_HEADERS.has(row.vendor.toLowerCase()));
}

export function parseVendorDirectoryCsv(source: string): SafeVendorImportRow[] {
  const table = parseCsvTable(source.replace(/^\uFEFF/, ""));
  if (!table.length) return [];
  const header = table[0].map((value) => value.trim().toLowerCase());
  const vendorIndex = findHeader(header, [
    "hard scape vendors",
    "vendor",
    "vendor name",
    "company",
  ]);
  const repNameIndex = findHeader(header, ["rep name", "sales rep", "contact name"]);
  const repEmailIndex = findHeader(header, ["rep email", "contact email"]);
  if (vendorIndex < 0) return [];

  let category: string | null = CATEGORY_HEADERS.has(header[vendorIndex])
    ? titleCase(header[vendorIndex].replace(/\s*vendors?$/i, ""))
    : null;
  const safeRows: SafeVendorImportRow[] = [];
  table.slice(1).forEach((row, index) => {
    const vendor = clean(row[vendorIndex], 160);
    if (!vendor) return;
    if (CATEGORY_HEADERS.has(vendor.toLowerCase()) || looksLikeCategoryRow(row)) {
      category = titleCase(vendor.replace(/\s*vendors?$/i, ""));
      return;
    }
    const repEmail = repEmailIndex >= 0 ? clean(row[repEmailIndex], 240) : "";
    safeRows.push({
      source_row_number: index + 2,
      vendor,
      category,
      rep_name: repNameIndex >= 0 ? nullable(row[repNameIndex], 160) : null,
      rep_email: validEmail(repEmail) ? repEmail.toLowerCase() : null,
    });
  });
  return safeRows;
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullable(value: unknown, max: number) {
  return clean(value, max) || null;
}

function validEmail(value: unknown) {
  const text = clean(value, 240);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function findHeader(headers: string[], options: string[]) {
  return headers.findIndex((header) => options.includes(header));
}

function looksLikeCategoryRow(row: string[]) {
  const populated = row.filter((value) => value.trim()).length;
  return populated === 1 && /^[A-Z][A-Z\s&()+/-]+$/.test(row[0]?.trim() ?? "");
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function parseCsvTable(source: string) {
  const table: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      table.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value);
    table.push(row);
  }
  return table;
}
