import { supabase } from "@/integrations/supabase/client";
import { PRODUCT_CATEGORIES, SUBCATEGORIES, type ProductCategory } from "@/lib/productCategories";
import type {
  RenderingStudioAssetType,
  RenderingStudioPresentationMode,
} from "@/lib/renderingStudioPackage";

export { PRODUCT_CATEGORIES, SUBCATEGORIES, type ProductCategory };

export type ProjectStatus = "Design" | "Presentation" | "Approved" | "Procurement" | "Complete";
export type UserRole = "Admin" | "Employee" | "Contractor" | "Client";
export type ProjectType =
  | "Kitchen"
  | "Bathroom"
  | "Whole Home"
  | "New Build"
  | "Furnishings"
  | "Commercial";
export type ProjectLabel = "Personal Home" | "Investor Renovation" | "Spec Build" | "D4D";
export type MaterialCategory =
  | "Cabinet Finish"
  | "Countertop"
  | "Flooring"
  | "Tile"
  | "Fabric"
  | "Paint";
export type ApprovalStatus = "undecided" | "approved" | "declined";

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  "Cabinet Finish",
  "Countertop",
  "Flooring",
  "Tile",
  "Fabric",
  "Paint",
];
export const PROJECT_TYPES: ProjectType[] = [
  "Kitchen",
  "Bathroom",
  "Whole Home",
  "New Build",
  "Furnishings",
  "Commercial",
];
export const PROJECT_LABELS: ProjectLabel[] = [
  "Personal Home",
  "Investor Renovation",
  "Spec Build",
  "D4D",
];
export const PROJECT_STATUSES: ProjectStatus[] = [
  "Design",
  "Presentation",
  "Approved",
  "Procurement",
  "Complete",
];

export const WORKFLOW_STAGES = [
  "Create Project & Rooms",
  "Design Selections",
  "Render and Draw SketchUp",
  "Construction Docs Completed",
  "AI Renderings",
  "Presentation Boards",
  "Client Approval",
  "Spec Book",
  "Procurement",
] as const;

async function syncFinancialInvoiceTotals(invoiceId: string) {
  const { data: payments } = await supabase
    .from("financial_invoice_payments")
    .select("amount,status")
    .eq("invoice_id", invoiceId);

  const rows = (payments ?? []) as Array<Pick<FinancialInvoicePayment, "amount" | "status">>;
  const totalAmount = rows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const paidAmount = rows
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  await supabase
    .from("financial_invoices")
    .update({
      total_amount: totalAmount,
      paid_amount: paidAmount,
      balance_due: Math.max(totalAmount - paidAmount, 0),
    } as any)
    .eq("id", invoiceId);
}

export interface Project {
  id: string;
  name: string;
  client_name: string;
  project_type: ProjectType;
  project_label: ProjectLabel | null;
  status: ProjectStatus;
  design_notes: string | null;
  cover_image_url: string | null;
  project_summary: string | null;
  design_concept: string | null;
  key_design_elements: string | null;
  approval_show_vendor: boolean;
  approval_show_pricing: boolean;
  approval_show_quantity: boolean;
  approval_show_dimensions: boolean;
  approval_show_finish: boolean;
  approval_live: boolean;
  client_can_view_spec_book: boolean;
  client_can_view_presentations: boolean;
  client_can_view_design_boards: boolean;
  client_can_download_design_board_pdf: boolean;
  client_can_view_construction_docs: boolean;
  client_can_download_construction_docs: boolean;
  client_can_download_spec_book_pdf: boolean;
  client_spec_show_pricing: boolean;
  client_spec_show_links: boolean;
  client_spec_show_ordering: boolean;
  contractor_can_view_spec_book: boolean;
  contractor_can_view_presentations: boolean;
  contractor_can_view_design_boards: boolean;
  contractor_can_download_design_board_pdf: boolean;
  contractor_can_view_construction_docs: boolean;
  contractor_can_download_spec_book_pdf: boolean;
  contractor_spec_show_pricing: boolean;
  contractor_spec_show_links: boolean;
  contractor_spec_show_ordering: boolean;
  contractor_spec_can_update_ordering: boolean;
  is_pinned: boolean;
  last_opened_at: string | null;
  accepted_date: string | null;
  turnaround_speed: "Standard" | "Priority" | "Rush" | "Custom" | null;
  promised_completion_date: string | null;
  forecast_completion_date: string | null;
  progress_override: number | null;
  health_override: "on_track" | "at_risk" | "critical" | "late" | null;
  health_override_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectDocumentType =
  | "SketchUp Rendering"
  | "AI Rendering"
  | "Layout Doc"
  | "Construction Doc";

export interface ProjectDocument {
  id: string;
  project_id: string;
  title: string;
  document_type: ProjectDocumentType;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  visible_to_contractors: boolean;
  visible_to_clients: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  project_id: string;
  name: string;
  cover_image_url: string | null;
  sort_order: number;
  design_concept: string | null;
  design_notes: string | null;
  presentation_palette_item_ids: string[] | null;
  presentation_palette_label: string | null;
  presentation_cabinet_label: string | null;
  presentation_counter_label: string | null;
  presentation_faucet_label: string | null;
  presentation_overlay_label: string | null;
  presentation_overlay_body: string | null;
  presentation_rendering_image_id: string | null;
  presentation_sketchup_image_id: string | null;
  presentation_cabinet_item_id: string | null;
  presentation_counter_item_id: string | null;
  presentation_faucet_item_id: string | null;
  approval_visible: boolean;
  created_at: string;
  updated_at: string;
}

export type RenderingStatus = "not_generated" | "queued" | "processing" | "complete" | "failed";
export type RenderingRole =
  | "hero"
  | "secondary"
  | "detail"
  | "sketchup_hero"
  | "single_hero"
  | "sketchup_single_hero";
export type RenderingReviewStatus = "draft" | "needs_revision" | "approved" | "rejected";

export interface RoomImage {
  id: string;
  room_id: string;
  kind: "sketchup" | "rendering";
  url: string;
  caption: string | null;
  linked_sketchup_id: string | null;
  sort_order: number;
  status: RenderingStatus;
  role: RenderingRole | null;
  is_favorite: boolean;
  is_approved: boolean;
  presentation_visible: boolean;
  review_status: RenderingReviewStatus;
  revision_notes: string | null;
  team_notes: string | null;
  revision_parent_id: string | null;
  revision_number: number;
  error_message: string | null;
  created_at?: string;
}

export interface RenderingStudioAsset {
  id: string;
  elevation_id: string;
  asset_type: RenderingStudioAssetType;
  filename: string;
  storage_bucket?: string;
  storage_path: string;
  url: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  updated_at: string;
}

export interface RenderingStudioElevation {
  id: string;
  project_id: string;
  package_id: string;
  room_id: string;
  elevation_id: string;
  sheet_number: string;
  room_name: string;
  title: string;
  materials: Array<Record<string, unknown>>;
  approval_status: string;
  review_status: string;
  workflow_status?: string;
  expected_cad_filename?: string | null;
  expected_render_filename?: string | null;
  expected_sheet_filename?: string | null;
  correction_note?: string | null;
  source_page_number?: number | null;
  current_revision_number?: number;
  presentation_order: number;
  presentation_mode: RenderingStudioPresentationMode;
  presentation_visible: boolean;
  created_at: string;
  updated_at: string;
  assets: RenderingStudioAsset[];
  revisions?: Array<Record<string, unknown>>;
  room?: Pick<Room, "id" | "name"> | null;
}

export interface Product {
  id: string;
  category: ProductCategory;
  subcategory: string | null;
  name: string;
  vendor: string | null;
  product_url: string | null;
  image_url: string | null;
  finish: string | null;
  sku: string | null;
  notes: string | null;
  dimensions: string | null;
  price: string | null;
  unit_cost: string | null;
  shipping: string | null;
  carton_coverage_sq_ft?: number | null;
  carton_coverage_source_url?: string | null;
  carton_coverage_source_text?: string | null;
  carton_coverage_confidence?: "exact" | "review" | "missing" | "manual" | null;
  carton_coverage_scraped_at?: string | null;
  description: string | null;
  has_sample: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoomProduct {
  id: string;
  room_id: string;
  product_id: string;
  is_key_selection: boolean;
  sort_order: number;
  room_notes: string | null;
  approved: boolean;
  approval_status: ApprovalStatus;
  approval_comment: string | null;
  approval_updated_at: string | null;
  approval_visible: boolean;
  product?: Product;
}

export interface Material {
  id: string;
  room_id: string;
  category: MaterialCategory;
  name: string;
  image_url: string | null;
  vendor: string | null;
  product_url: string | null;
  sku: string | null;
  notes: string | null;
  sort_order: number;
}

export interface ProcurementItem {
  id: string;
  room_product_id: string;
  ordered: boolean;
  received: boolean;
  installed: boolean;
  notes: string | null;
  updated_at: string;
}

export interface MaterialItem {
  id: string;
  room_id: string;
  project_id: string;
  item_label: string;
  client_product_name: string | null;
  category: string | null;
  is_required: boolean;
  sort_order: number;
  cad_label: string | null;
  product_url: string | null;
  quantity: number | null;
  color: string | null;
  image_url: string | null;
  notes: string | null;
  not_needed: boolean;
  ordered_by?: "Contractor" | "Merav" | "Client" | null;
  ordered?: boolean;
  product_id: string | null;
  source_board_id: string | null;
  source_board_page_id: string | null;
  source_board_element_id: string | null;
  scrape_status: string;
  scrape_error: string | null;
  finish_check_status?: "unchecked" | "match" | "possible_mismatch" | "uncertain";
  finish_check_image_finish?: string | null;
  finish_check_product_finish?: string | null;
  finish_check_image_url?: string | null;
  finish_check_confidence?: number | null;
  finish_check_reason?: string | null;
  finish_checked_at?: string | null;
  created_at: string;
  updated_at: string;
  product?: Product | null;
  room_product?: RoomProduct | null;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  is_owner: boolean;
  can_view_all_projects: boolean;
  hourly_rate: number;
  created_at: string;
  updated_at: string;
}

export type FinancialPaymentStatus = "not_due" | "due" | "paid" | "waived";

function isMissingColumnError(error: unknown, column: string) {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === "42703" && Boolean(candidate.message?.includes(column));
}

export interface FinancialInvoice {
  id: string;
  project_id: string | null;
  file_name: string | null;
  pdf_data_url: string | null;
  invoice_date: string | null;
  client_name: string | null;
  provider_name: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  balance_due: number | null;
  raw_text: string | null;
  client_visible: boolean;
  quickbooks_invoice_id?: string | null;
  quickbooks_sync_status?: "not_sent" | "sent" | "failed" | null;
  quickbooks_synced_at?: string | null;
  quickbooks_sync_error?: string | null;
  created_at: string;
  updated_at: string;
  payments?: FinancialInvoicePayment[];
  project?: Pick<Project, "id" | "name" | "client_name" | "status"> | null;
}

export interface FinancialInvoicePayment {
  id: string;
  invoice_id: string;
  project_id: string | null;
  label: string;
  amount: number;
  due_date: string | null;
  status: FinancialPaymentStatus;
  notes: string | null;
  stripe_payment_link_id?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  paid_at?: string | null;
  quickbooks_payment_id?: string | null;
  quickbooks_synced_at?: string | null;
  quickbooks_sync_error?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectTimeline {
  id: string;
  project_id: string | null;
  title: string | null;
  project_name: string | null;
  client_name: string | null;
  timeline_date: string | null;
  html_data_url: string | null;
  raw_text: string | null;
  client_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmployeeTimeEntry {
  id: string;
  user_id: string;
  work_date: string;
  hours: number;
  task_project: string;
  hourly_rate: number;
  paid: boolean;
  paid_on: string | null;
  paid_through: string | null;
  project_id?: string | null;
  todo_id?: string | null;
  created_at: string;
  updated_at: string;
  user?: Pick<UserProfile, "id" | "email" | "full_name" | "hourly_rate"> | null;
}

export interface DesignBoardRecord {
  project_id: string;
  board_state: unknown;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesignBoardVersionRecord {
  version_id: string;
  design_board_id: string;
  project_id: string;
  board_state_snapshot: unknown;
  created_at: string;
  created_by: string | null;
  save_type: string;
  save_reason: string | null;
}

export type DesignBoardVersionMeta = Omit<DesignBoardVersionRecord, "board_state_snapshot">;

async function getCurrentProjectAccess() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    return { profile: null, assignedProjectIds: [] as string[] };
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  const typedProfile = (profile as UserProfile | null) ?? null;
  if (!typedProfile || !typedProfile.is_active) {
    return { profile: typedProfile, assignedProjectIds: [] as string[] };
  }

  if (
    typedProfile.role !== "Client" &&
    typedProfile.role !== "Contractor" &&
    (typedProfile.role !== "Employee" || typedProfile.can_view_all_projects !== false)
  ) {
    return { profile: typedProfile, assignedProjectIds: [] as string[] };
  }

  const { data: assignments } = await supabase
    .from("user_project_assignments")
    .select("project_id")
    .eq("user_id", userId);

  return {
    profile: typedProfile,
    assignedProjectIds: (assignments ?? [])
      .map((assignment: any) => assignment.project_id)
      .filter(
        (projectId: unknown): projectId is string =>
          typeof projectId === "string" && projectId.length > 0,
      ),
  };
}

export const db = {
  getCurrentUserProfile: async () => {
    const { profile } = await getCurrentProjectAccess();
    return profile;
  },

  /* PROJECTS */
  listProjects: async () => {
    const { profile, assignedProjectIds } = await getCurrentProjectAccess();
    const baseQuery = () => supabase.from("projects").select("*");
    let query = baseQuery()
      .order("is_pinned", { ascending: false })
      .order("last_opened_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });

    if (
      profile &&
      (profile.role === "Client" ||
        profile.role === "Contractor" ||
        (profile.role === "Employee" && profile.can_view_all_projects === false))
    ) {
      if (!assignedProjectIds.length) return [] as Project[];
      query = query.in("id", assignedProjectIds);
    }

    const result = await query;
    if (!result.error) return result.data as Project[] | null;
    if (result.error.code !== "42703") return null;

    let fallback = baseQuery().order("updated_at", { ascending: false });
    if (
      profile &&
      (profile.role === "Client" ||
        profile.role === "Contractor" ||
        (profile.role === "Employee" && profile.can_view_all_projects === false))
    ) {
      if (!assignedProjectIds.length) return [] as Project[];
      fallback = fallback.in("id", assignedProjectIds);
    }

    return (await fallback).data as Project[] | null;
  },
  getProject: async (id: string) => {
    const { profile, assignedProjectIds } = await getCurrentProjectAccess();
    if (
      profile &&
      (profile.role === "Client" ||
        profile.role === "Contractor" ||
        (profile.role === "Employee" && profile.can_view_all_projects === false)) &&
      !assignedProjectIds.includes(id)
    ) {
      return null;
    }

    return (await supabase.from("projects").select("*").eq("id", id).maybeSingle())
      .data as Project | null;
  },
  createProject: async (p: {
    name: string;
    client_name: string;
    project_type: ProjectType;
    design_notes?: string;
  }) => (await supabase.from("projects").insert(p).select().single()).data as Project | null,
  updateProject: async (id: string, p: Partial<Project>) =>
    (
      await supabase
        .from("projects")
        .update(p as any)
        .eq("id", id)
        .select()
        .single()
    ).data as Project | null,
  markProjectOpened: async (id: string) =>
    supabase
      .from("projects")
      .update({ last_opened_at: new Date().toISOString() } as any)
      .eq("id", id),

  /* PROJECT DOCUMENTS */
  listProjectDocuments: async (projectId: string) =>
    (
      await supabase
        .from("project_documents" as any)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
    ).data as ProjectDocument[] | null,
  createProjectDocument: async (
    document: Omit<ProjectDocument, "id" | "created_at" | "updated_at">,
  ) =>
    (
      await supabase
        .from("project_documents" as any)
        .insert(document as any)
        .select()
        .single()
    ).data as ProjectDocument | null,
  deleteProjectDocument: async (id: string) =>
    supabase
      .from("project_documents" as any)
      .delete()
      .eq("id", id),

  /* ROOMS */
  listRooms: async (projectId: string) =>
    (
      await supabase
        .from("rooms")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at")
    ).data as Room[] | null,
  getRoom: async (id: string) =>
    (await supabase.from("rooms").select("*").eq("id", id).maybeSingle()).data as Room | null,
  createRoom: async (r: { project_id: string; name: string }) =>
    (await supabase.from("rooms").insert(r).select().single()).data as Room | null,
  updateRoom: async (id: string, r: Partial<Room>) =>
    (await supabase.from("rooms").update(r).eq("id", id).select().single()).data as Room | null,
  deleteRoom: async (id: string) => supabase.from("rooms").delete().eq("id", id),

  /* ROOM IMAGES */
  listRoomImages: async (roomId: string) =>
    (await supabase.from("room_images").select("*").eq("room_id", roomId).order("sort_order"))
      .data as RoomImage[] | null,
  addRoomImage: async (img: {
    room_id: string;
    kind: "sketchup" | "rendering";
    url: string;
    caption?: string;
    linked_sketchup_id?: string | null;
    status?: RenderingStatus;
    role?: RenderingRole | null;
    is_approved?: boolean;
    review_status?: RenderingReviewStatus;
    revision_notes?: string | null;
    revision_parent_id?: string | null;
    revision_number?: number;
  }) => (await supabase.from("room_images").insert(img).select().single()).data as RoomImage | null,
  updateRoomImage: async (id: string, patch: Partial<RoomImage>) =>
    (
      await supabase
        .from("room_images")
        .update(patch as any)
        .eq("id", id)
        .select()
        .single()
    ).data as RoomImage | null,
  deleteRoomImage: async (id: string) => supabase.from("room_images").delete().eq("id", id),
  listProjectRoomImages: async (projectId: string) => {
    const { data: rooms } = await supabase.from("rooms").select("id").eq("project_id", projectId);
    const ids = (rooms ?? []).map((r: any) => r.id);
    if (!ids.length) return [] as RoomImage[];
    const { data } = await supabase
      .from("room_images")
      .select("*")
      .in("room_id", ids)
      .order("sort_order");
    return (data ?? []) as RoomImage[];
  },

  /* RENDERING STUDIO ELEVATIONS */
  listRenderingStudioElevations: async (projectId: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (accessToken) {
      try {
        const response = await fetch(
          `/api/rendering-studio?projectId=${encodeURIComponent(projectId)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (response.ok) {
          const body = (await response.json()) as {
            elevations?: RenderingStudioElevation[];
          };
          if (Array.isArray(body.elevations)) return body.elevations;
        }
      } catch {
        // The legacy direct query remains available until the workflow migration is applied.
      }
    }
    const { data, error } = await supabase
      .from("rendering_studio_elevations" as any)
      .select("*, room:rooms(id,name), assets:rendering_studio_assets(*)")
      .eq("project_id", projectId)
      .order("presentation_order")
      .order("created_at");
    if (error) throw error;
    return (data ?? []) as RenderingStudioElevation[];
  },
  updateRenderingStudioElevation: async (
    id: string,
    patch: Partial<Pick<RenderingStudioElevation, "presentation_mode" | "presentation_visible">>,
  ) => {
    const { data, error } = await supabase
      .from("rendering_studio_elevations" as any)
      .update(patch as any)
      .eq("id", id)
      .select("*, room:rooms(id,name), assets:rendering_studio_assets(*)")
      .single();
    if (error) throw error;
    return data as RenderingStudioElevation;
  },

  /* PRODUCT CATALOG (global) */
  listCatalog: async (search?: string) => {
    let q = supabase.from("products").select("*").order("updated_at", { ascending: false });
    if (search?.trim()) q = q.ilike("name", `%${search.trim()}%`);
    return (await q).data as Product[] | null;
  },
  listProjectCatalogProductIds: async (projectId: string) => {
    const ids = new Set<string>();

    const { data: materialItems } = await supabase
      .from("material_items")
      .select("product_id")
      .eq("project_id", projectId)
      .not("product_id", "is", null);
    (materialItems ?? []).forEach((item: any) => {
      if (typeof item.product_id === "string") ids.add(item.product_id);
    });

    const { data: rooms } = await supabase.from("rooms").select("id").eq("project_id", projectId);
    const roomIds = (rooms ?? [])
      .map((room: any) => room.id)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
    if (roomIds.length) {
      const { data: roomProducts } = await supabase
        .from("room_products")
        .select("product_id")
        .in("room_id", roomIds);
      (roomProducts ?? []).forEach((item: any) => {
        if (typeof item.product_id === "string") ids.add(item.product_id);
      });
    }

    return Array.from(ids);
  },
  getProduct: async (id: string) =>
    (await supabase.from("products").select("*").eq("id", id).maybeSingle()).data as Product | null,
  createProduct: async (
    p: Partial<Omit<Product, "id" | "created_at" | "updated_at">> &
      Pick<Product, "name" | "category">,
  ) => (await supabase.from("products").insert(p).select().single()).data as Product | null,
  updateProduct: async (id: string, p: Partial<Product>) =>
    (await supabase.from("products").update(p).eq("id", id).select().single())
      .data as Product | null,
  deleteProduct: async (id: string) => supabase.from("products").delete().eq("id", id),

  /* ROOM PRODUCTS (selections) */
  listRoomProducts: async (roomId: string) =>
    (
      await supabase
        .from("room_products")
        .select("*, product:products(*)")
        .eq("room_id", roomId)
        .order("sort_order")
    ).data as RoomProduct[] | null,
  addRoomProduct: async (rp: { room_id: string; product_id: string; is_key_selection?: boolean }) =>
    (await supabase.from("room_products").insert(rp).select().single()).data,
  updateRoomProduct: async (id: string, rp: Partial<RoomProduct>) =>
    supabase
      .from("room_products")
      .update(rp as any)
      .eq("id", id),
  removeRoomProduct: async (id: string) => supabase.from("room_products").delete().eq("id", id),

  /* MATERIALS */
  listMaterials: async (roomId: string) =>
    (await supabase.from("materials").select("*").eq("room_id", roomId).order("sort_order"))
      .data as Material[] | null,
  addMaterial: async (m: {
    room_id: string;
    category: MaterialCategory;
    name: string;
    image_url?: string | null;
    vendor?: string | null;
    product_url?: string | null;
    sku?: string | null;
    notes?: string | null;
  }) => (await supabase.from("materials").insert(m).select().single()).data,
  deleteMaterial: async (id: string) => supabase.from("materials").delete().eq("id", id),

  /* PROCUREMENT */
  listProcurement: async () => {
    const { data } = await supabase
      .from("procurement_items")
      .select(
        "*, room_product:room_products(*, product:products(*), room:rooms(*, project:projects(id, name, client_name, status)))",
      )
      .order("updated_at", { ascending: false });
    const items = (data ?? []) as Array<
      ProcurementItem & {
        room_product: RoomProduct & {
          product: Product;
          room: Room & { project: Pick<Project, "id" | "name" | "client_name" | "status"> };
        };
      }
    >;

    // Enrich with material_item details (qty / color / link / cad)
    const pairs = items
      .map((i) => ({ room_id: i.room_product?.room?.id, product_id: i.room_product?.product?.id }))
      .filter((p) => p.room_id && p.product_id);
    if (pairs.length) {
      const productIds = Array.from(new Set(pairs.map((p) => p.product_id!)));
      const { data: mats } = await supabase
        .from("material_items")
        .select(
          "id, room_id, product_id, client_product_name, quantity, color, product_url, cad_label, notes",
        )
        .in("product_id", productIds);
      const matMap = new Map<string, any>();
      (mats ?? []).forEach((m: any) => matMap.set(`${m.room_id}::${m.product_id}`, m));
      items.forEach((i: any) => {
        const key = `${i.room_product?.room?.id}::${i.room_product?.product?.id}`;
        i.material = matMap.get(key) ?? null;
      });
    }
    return items as Array<
      ProcurementItem & {
        room_product: RoomProduct & {
          product: Product;
          room: Room & { project: Pick<Project, "id" | "name" | "client_name" | "status"> };
        };
        material?: {
          client_product_name: string | null;
          id: string;
          quantity: number | null;
          color: string | null;
          product_url: string | null;
          cad_label: string | null;
          notes: string | null;
        } | null;
      }
    >;
  },
  updateProcurement: async (id: string, p: Partial<ProcurementItem>) =>
    supabase.from("procurement_items").update(p).eq("id", id),

  /* MATERIAL ITEMS (guided checklist) */
  listMaterialItemsByProject: async (projectId: string) => {
    const { data } = await supabase
      .from("material_items")
      .select("*, product:products(*)")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    const items = (data ?? []) as MaterialItem[];
    const productIds = Array.from(
      new Set(items.map((item) => item.product_id).filter((id): id is string => Boolean(id))),
    );
    if (!productIds.length) return items;

    const roomIds = Array.from(new Set(items.map((item) => item.room_id).filter(Boolean)));
    const { data: roomProducts } = await supabase
      .from("room_products")
      .select("*")
      .in("room_id", roomIds)
      .in("product_id", productIds);
    const roomProductMap = new Map<string, RoomProduct>();
    (roomProducts ?? []).forEach((roomProduct: RoomProduct) => {
      roomProductMap.set(`${roomProduct.room_id}::${roomProduct.product_id}`, roomProduct);
    });

    return items.map((item) => ({
      ...item,
      room_product: item.product_id
        ? (roomProductMap.get(`${item.room_id}::${item.product_id}`) ?? null)
        : null,
    }));
  },
  bulkInsertMaterialItems: async (
    items: Array<Omit<MaterialItem, "id" | "created_at" | "updated_at" | "product">>,
  ) => supabase.from("material_items").insert(items as any),
  updateMaterialItem: async (id: string, patch: Partial<MaterialItem>) => {
    const result = await supabase
      .from("material_items")
      .update(patch as any)
      .eq("id", id);
    if (result.error && isMissingColumnError(result.error, "image_url") && "image_url" in patch) {
      const { image_url: _imageUrl, ...legacyPatch } = patch;
      return supabase
        .from("material_items")
        .update(legacyPatch as any)
        .eq("id", id);
    }
    return result;
  },
  updateMaterialItemsByProduct: async (productId: string, patch: Partial<MaterialItem>) =>
    supabase
      .from("material_items")
      .update(patch as any)
      .eq("product_id", productId),
  deleteMaterialItem: async (id: string) => supabase.from("material_items").delete().eq("id", id),
  findProductByUrl: async (url: string) =>
    (await supabase.from("products").select("*").eq("product_url", url).maybeSingle())
      .data as Product | null,
  findProductsByUrlAndName: async (url: string, name: string) =>
    (await supabase.from("products").select("*").eq("product_url", url).eq("name", name).limit(25))
      .data as Product[] | null,
  findProductByUrlAndName: async (url: string, name: string) =>
    (await supabase.from("products").select("*").eq("product_url", url).eq("name", name).limit(1))
      .data?.[0] as Product | null,

  /* FINANCIALS */
  listAllFinancialInvoices: async () =>
    (
      await supabase
        .from("financial_invoices")
        .select(
          "*, project:projects(id, name, client_name, status), payments:financial_invoice_payments(*)",
        )
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("sort_order", { referencedTable: "financial_invoice_payments", ascending: true })
    ).data as FinancialInvoice[] | null,
  listFinancialInvoices: async (projectId: string) =>
    (
      await supabase
        .from("financial_invoices")
        .select("*, payments:financial_invoice_payments(*)")
        .eq("project_id", projectId)
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("sort_order", { referencedTable: "financial_invoice_payments", ascending: true })
    ).data as FinancialInvoice[] | null,
  listUnattachedFinancialInvoices: async () =>
    (
      await supabase
        .from("financial_invoices")
        .select("*, payments:financial_invoice_payments(*)")
        .is("project_id", null)
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("sort_order", { referencedTable: "financial_invoice_payments", ascending: true })
    ).data as FinancialInvoice[] | null,
  createFinancialInvoice: async (
    invoice: Omit<FinancialInvoice, "id" | "created_at" | "updated_at" | "payments">,
    payments: Array<
      Omit<FinancialInvoicePayment, "id" | "invoice_id" | "created_at" | "updated_at">
    >,
  ) => {
    const insertInvoice = async (payload: typeof invoice) =>
      supabase
        .from("financial_invoices")
        .insert(payload as any)
        .select()
        .single();

    let { data: created, error: invoiceError } = await insertInvoice(invoice);
    if (invoiceError?.code === "42703" && invoiceError.message?.includes("client_visible")) {
      const { client_visible: _clientVisible, ...legacyInvoice } = invoice as typeof invoice & {
        client_visible?: boolean;
      };
      ({ data: created, error: invoiceError } = await insertInvoice(legacyInvoice));
    }
    if (invoiceError) throw invoiceError;
    if (!created) return null;
    if (payments.length) {
      const { error: paymentsError } = await supabase
        .from("financial_invoice_payments")
        .insert(payments.map((payment) => ({ ...payment, invoice_id: created.id })) as any);
      if (paymentsError) throw paymentsError;
    }
    return created as FinancialInvoice;
  },
  attachFinancialInvoiceToProject: async (invoiceId: string, projectId: string) => {
    const invoice = (
      await supabase
        .from("financial_invoices")
        .update({ project_id: projectId, client_visible: true } as any)
        .eq("id", invoiceId)
        .select()
        .single()
    ).data as FinancialInvoice | null;
    await supabase
      .from("financial_invoice_payments")
      .update({ project_id: projectId } as any)
      .eq("invoice_id", invoiceId);
    return invoice;
  },
  updateFinancialPayment: async (id: string, patch: Partial<FinancialInvoicePayment>) => {
    const payment = (
      await supabase
        .from("financial_invoice_payments")
        .update(patch as any)
        .eq("id", id)
        .select()
        .single()
    ).data as FinancialInvoicePayment | null;

    if (payment?.invoice_id) {
      await syncFinancialInvoiceTotals(payment.invoice_id);
    }

    return payment;
  },
  updateFinancialInvoice: async (id: string, patch: Partial<FinancialInvoice>) =>
    (
      await supabase
        .from("financial_invoices")
        .update(patch as any)
        .eq("id", id)
        .select()
        .single()
    ).data as FinancialInvoice | null,
  deleteFinancialInvoice: async (id: string) =>
    supabase.from("financial_invoices").delete().eq("id", id),

  /* PROJECT TIMELINES */
  listProjectTimelines: async (projectId: string) =>
    (
      await supabase
        .from("project_timelines" as any)
        .select("*")
        .eq("project_id", projectId)
        .order("timeline_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
    ).data as ProjectTimeline[] | null,
  listUnattachedProjectTimelines: async () =>
    (
      await supabase
        .from("project_timelines" as any)
        .select("*")
        .is("project_id", null)
        .order("timeline_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
    ).data as ProjectTimeline[] | null,
  createProjectTimeline: async (
    timeline: Omit<ProjectTimeline, "id" | "created_at" | "updated_at">,
  ) =>
    (
      await supabase
        .from("project_timelines" as any)
        .insert(timeline as any)
        .select()
        .single()
    ).data as ProjectTimeline | null,
  attachProjectTimelineToProject: async (timelineId: string, projectId: string) =>
    (
      await supabase
        .from("project_timelines" as any)
        .update({ project_id: projectId, client_visible: true } as any)
        .eq("id", timelineId)
        .select()
        .single()
    ).data as ProjectTimeline | null,
  updateProjectTimeline: async (id: string, patch: Partial<ProjectTimeline>) =>
    (
      await supabase
        .from("project_timelines" as any)
        .update(patch as any)
        .eq("id", id)
        .select()
        .single()
    ).data as ProjectTimeline | null,
  deleteProjectTimeline: async (id: string) =>
    supabase
      .from("project_timelines" as any)
      .delete()
      .eq("id", id),

  /* DESIGN BOARDS */
  getDesignBoard: async (projectId: string) =>
    (
      await supabase
        .from("design_boards" as any)
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle()
    ).data as DesignBoardRecord | null,
  insertDesignBoard: async (projectId: string, boardState: unknown, updatedBy?: string | null) => {
    const { data, error } = await supabase
      .from("design_boards" as any)
      .insert({
        project_id: projectId,
        board_state: boardState,
        updated_by: updatedBy ?? null,
      } as any)
      .select()
      .single();
    if (error) throw error;
    return data as DesignBoardRecord | null;
  },
  updateDesignBoardIfFresh: async (
    projectId: string,
    boardState: unknown,
    expectedUpdatedAt: string,
    updatedBy?: string | null,
  ) =>
    (
      await supabase
        .from("design_boards" as any)
        .update({ board_state: boardState, updated_by: updatedBy ?? null } as any)
        .eq("project_id", projectId)
        .eq("updated_at", expectedUpdatedAt)
        .select()
        .maybeSingle()
    ).data as DesignBoardRecord | null,
  upsertDesignBoard: async (projectId: string, boardState: unknown, updatedBy?: string | null) => {
    const { data, error } = await supabase
      .from("design_boards" as any)
      .upsert(
        { project_id: projectId, board_state: boardState, updated_by: updatedBy ?? null } as any,
        {
          onConflict: "project_id",
        },
      )
      .select()
      .single();
    if (error) throw error;
    return data as DesignBoardRecord | null;
  },
  listDesignBoardVersions: async (projectId: string, limit = 60) =>
    (
      await supabase
        .from("design_board_versions" as any)
        .select(
          "version_id, design_board_id, project_id, created_at, created_by, save_type, save_reason",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .order("version_id", { ascending: false })
        .limit(limit)
    ).data as DesignBoardVersionMeta[] | null,
  getDesignBoardVersion: async (versionId: string) =>
    (
      await supabase
        .from("design_board_versions" as any)
        .select("*")
        .eq("version_id", versionId)
        .maybeSingle()
    ).data as DesignBoardVersionRecord | null,
  restoreDesignBoardVersion: async (
    version: Pick<DesignBoardVersionRecord, "project_id" | "board_state_snapshot">,
    updatedBy?: string | null,
  ) => db.upsertDesignBoard(version.project_id, version.board_state_snapshot, updatedBy),

  /* HOURS */
  listEmployeeTimeEntries: async () =>
    (
      await supabase
        .from("employee_time_entries")
        .select("*, user:user_profiles(id,email,full_name,hourly_rate)")
        .order("work_date", { ascending: false })
        .order("created_at", { ascending: false })
    ).data as EmployeeTimeEntry[] | null,
  createEmployeeTimeEntry: async (
    entry: Pick<
      EmployeeTimeEntry,
      "user_id" | "work_date" | "hours" | "task_project" | "hourly_rate"
    > &
      Pick<EmployeeTimeEntry, "project_id" | "todo_id">,
  ) =>
    (
      await supabase
        .from("employee_time_entries")
        .insert(entry as any)
        .select("*, user:user_profiles(id,email,full_name,hourly_rate)")
        .single()
    ).data as EmployeeTimeEntry | null,
  updateEmployeeTimeEntry: async (id: string, patch: Partial<EmployeeTimeEntry>) =>
    (
      await supabase
        .from("employee_time_entries")
        .update(patch as any)
        .eq("id", id)
        .select("*, user:user_profiles(id,email,full_name,hourly_rate)")
        .single()
    ).data as EmployeeTimeEntry | null,
  deleteEmployeeTimeEntry: async (id: string) =>
    supabase.from("employee_time_entries").delete().eq("id", id),
};
