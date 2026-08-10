/* eslint-disable @typescript-eslint/no-explicit-any -- New server-only tables are intentionally untyped until Supabase types are regenerated after the migration is applied. */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildCodexDeepLink,
  buildProcurementDraft,
  buildProcurementPrompt,
  buildRunSnapshots,
  classifyProcurementDraft,
  isRetryableStatus,
  parseMoney,
  type ProcurementDraft,
  type ProcurementItemStatus,
  type ProcurementMethod,
  type ProcurementQuantityUnit,
  type ProcurementRunResult,
  type ProcurementSnapshot,
} from "@/lib/procurementCart";
import {
  generateRunAuthorization,
  hashRunAuthorization,
  procurementRunExpiry,
} from "@/lib/procurementToken.server";

const admin = supabaseAdmin as any;

export interface ProcurementDraftOverride {
  spec_book_item_id: string;
  quantity: number | null;
  quantity_unit?: ProcurementQuantityUnit;
  carton_coverage_sq_ft?: number | null;
  waste_percentage?: number | null;
  color?: string;
  finish?: string;
  size?: string;
  dimensions?: string;
  other_requirements?: string;
  substitution_instructions?: string;
  required_option_keys?: ProcurementDraft["requiredOptionKeys"];
  procurement_method?: ProcurementMethod;
  rep_email?: string;
}

export interface PreparedProcurementRun {
  run: ProcurementRunResult;
  runAuthorization: string;
  prompt: string;
  deepLink: string;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableString(value: unknown) {
  const valueString = asString(value);
  return valueString || null;
}

function numeric(value: unknown) {
  return parseMoney(value);
}

function procurementMethod(value: unknown, fallback: ProcurementMethod): ProcurementMethod {
  return value === "email_rep" || value === "online_cart" ? value : fallback;
}

function quantityUnit(value: unknown, fallback: ProcurementQuantityUnit): ProcurementQuantityUnit {
  return value === "pieces" || value === "boxes" || value === "square_feet" ? value : fallback;
}

function normalizeRunItem(row: any) {
  return {
    ...row,
    requested_quantity: Number(row.requested_quantity),
    expected_price: numeric(row.expected_price),
    observed_price: numeric(row.observed_price),
    requested_options: row.requested_options ?? {},
    observed_options: row.observed_options ?? {},
  };
}

export async function getProcurementRunResult(runId: string): Promise<ProcurementRunResult | null> {
  const { data: run, error } = await admin
    .from("procurement_runs")
    .select("*, project:projects(id,name)")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  if (!run) return null;

  const { data: items, error: itemsError } = await admin
    .from("procurement_run_items")
    .select("*")
    .eq("run_id", runId)
    .order("retailer_domain")
    .order("created_at");
  if (itemsError) throw itemsError;

  return {
    ...run,
    project_name: run.project?.name ?? "Project",
    items: (items ?? []).map(normalizeRunItem),
  } as ProcurementRunResult;
}

export async function listProcurementRuns(projectId: string) {
  const { data: runs, error } = await admin
    .from("procurement_runs")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const results = await Promise.all(
    (runs ?? []).map((run: { id: string }) => getProcurementRunResult(run.id)),
  );
  return results.filter(Boolean) as ProcurementRunResult[];
}

function selectionFingerprint(snapshots: ProcurementSnapshot[]) {
  const canonical = snapshots
    .slice()
    .sort((a, b) => a.spec_book_item_id.localeCompare(b.spec_book_item_id))
    .map((snapshot) => ({
      id: snapshot.spec_book_item_id,
      quantity: snapshot.requested_quantity,
      options: snapshot.requested_options,
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function createRunFromSnapshots(input: {
  projectId: string;
  userId: string;
  snapshots: ProcurementSnapshot[];
  sourceRunId?: string | null;
  retryCounts?: Map<string, number>;
}): Promise<PreparedProcurementRun> {
  if (!input.snapshots.length) throw new Error("Select at least one Ready product.");
  const runAuthorization = generateRunAuthorization();
  const tokenHash = hashRunAuthorization(runAuthorization);
  const fingerprint = selectionFingerprint(input.snapshots);

  const { data: existing } = await admin
    .from("procurement_runs")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("created_by", input.userId)
    .eq("selection_fingerprint", fingerprint)
    .in("status", ["prepared", "in_progress"])
    .is("token_revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (existing) {
    const duplicate = new Error("An active cart run already contains this exact selection.");
    (duplicate as Error & { code?: string; runId?: string }).code = "ACTIVE_RUN_EXISTS";
    (duplicate as Error & { code?: string; runId?: string }).runId = existing.id;
    throw duplicate;
  }

  const { data: run, error: runError } = await admin
    .from("procurement_runs")
    .insert({
      project_id: input.projectId,
      created_by: input.userId,
      source_run_id: input.sourceRunId ?? null,
      status: "prepared",
      selection_fingerprint: fingerprint,
      token_hash: tokenHash,
      expires_at: procurementRunExpiry(),
    })
    .select("id")
    .single();
  if (runError) throw runError;

  const itemRows = input.snapshots.map((snapshot) => ({
    run_id: run.id,
    ...snapshot,
    retry_count: input.retryCounts?.get(snapshot.spec_book_item_id) ?? 0,
    status: "prepared",
  }));
  const { error: itemsError } = await admin.from("procurement_run_items").insert(itemRows);
  if (itemsError) {
    await admin.from("procurement_runs").delete().eq("id", run.id);
    throw itemsError;
  }

  const result = await getProcurementRunResult(run.id);
  if (!result) throw new Error("The cart run was created but could not be reloaded.");
  const prompt = buildProcurementPrompt({ runId: run.id, runAuthorization });
  return {
    run: result,
    runAuthorization,
    prompt,
    deepLink: buildCodexDeepLink(prompt),
  };
}

export async function createProcurementRun(input: {
  projectId: string;
  userId: string;
  overrides: ProcurementDraftOverride[];
}) {
  const requestedIds = Array.from(
    new Set(
      input.overrides.map((override) => asString(override.spec_book_item_id)).filter(Boolean),
    ),
  );
  if (!requestedIds.length) throw new Error("Select at least one Ready product.");

  const [{ data: project, error: projectError }, { data: sourceItems, error: sourceError }] =
    await Promise.all([
      admin.from("projects").select("id,name").eq("id", input.projectId).maybeSingle(),
      admin
        .from("material_items")
        .select("*, product:products(*), room:rooms!material_items_room_id_fkey(id,name)")
        .eq("project_id", input.projectId)
        .in("id", requestedIds),
    ]);
  if (projectError) throw projectError;
  if (sourceError) throw sourceError;
  if (!project) throw new Error("Project not found.");
  if ((sourceItems ?? []).length !== requestedIds.length) {
    throw new Error("One or more selected Spec Book products are not in this project.");
  }

  const overrideById = new Map(
    input.overrides.map((override) => [override.spec_book_item_id, override] as const),
  );
  const typedSourceItems = (sourceItems ?? []) as any[];
  const roomIds = Array.from(new Set(typedSourceItems.map((item) => item.room_id).filter(Boolean)));
  const productIds = Array.from(
    new Set(typedSourceItems.map((item) => item.product_id).filter(Boolean)),
  );
  const { data: roomProducts, error: roomProductsError } =
    roomIds.length && productIds.length
      ? await admin
          .from("room_products")
          .select("*")
          .in("room_id", roomIds)
          .in("product_id", productIds)
      : { data: [], error: null };
  if (roomProductsError) throw roomProductsError;
  const roomProductByPair = new Map(
    (roomProducts ?? []).map((item: any) => [`${item.room_id}::${item.product_id}`, item]),
  );
  const drafts: ProcurementDraft[] = typedSourceItems.map((source: any) => {
    const override = overrideById.get(source.id);
    const draft = buildProcurementDraft(
      {
        ...source,
        room_product: roomProductByPair.get(`${source.room_id}::${source.product_id}`) ?? null,
      },
      project,
      source.room,
      true,
    );
    return {
      ...draft,
      quantity: override?.quantity ?? null,
      quantityUnit: quantityUnit(override?.quantity_unit, draft.quantityUnit),
      cartonCoverageSquareFeet: numeric(override?.carton_coverage_sq_ft),
      wastePercentage: numeric(override?.waste_percentage),
      color: asString(override?.color ?? draft.color),
      finish: asString(override?.finish ?? draft.finish),
      size: asString(override?.size ?? draft.size),
      dimensions: asString(override?.dimensions ?? draft.dimensions),
      otherRequirements: asString(override?.other_requirements),
      substitutionInstructions: asString(override?.substitution_instructions),
      requiredOptionKeys: Array.isArray(override?.required_option_keys)
        ? override.required_option_keys
        : draft.requiredOptionKeys,
      procurementMethod: procurementMethod(override?.procurement_method, draft.procurementMethod),
      repEmail: asString(override?.rep_email ?? draft.repEmail).slice(0, 320),
      selected: true,
    } satisfies ProcurementDraft;
  });

  const blocked = drafts
    .map((draft: ProcurementDraft) => ({
      specBookItemId: draft.specBookItemId,
      productName: draft.productName,
      status: classifyProcurementDraft(draft),
    }))
    .filter((item: { status: string }) => item.status !== "ready");
  if (blocked.length) {
    const error = new Error("Some selected products are not Ready.");
    (error as Error & { code?: string; blocked?: unknown }).code = "PREFLIGHT_FAILED";
    (error as Error & { code?: string; blocked?: unknown }).blocked = blocked;
    throw error;
  }

  return createRunFromSnapshots({
    projectId: input.projectId,
    userId: input.userId,
    snapshots: buildRunSnapshots(drafts),
  });
}

export async function retryProcurementRun(input: { runId: string; userId: string }) {
  const previous = await getProcurementRunResult(input.runId);
  if (!previous) throw new Error("Cart run not found.");
  const retryItems = previous.items.filter((item) => isRetryableStatus(item.status));
  if (!retryItems.length) throw new Error("This run has no unresolved products to retry.");

  await admin
    .from("procurement_runs")
    .update({
      status: previous.status === "completed" ? "completed" : "cancelled",
      cancelled_at:
        previous.status === "completed" ? previous.cancelled_at : new Date().toISOString(),
      token_revoked_at: new Date().toISOString(),
    })
    .eq("id", previous.id);

  const retryCounts = new Map(
    retryItems.map((item) => [item.spec_book_item_id, item.retry_count + 1] as const),
  );
  const snapshots: ProcurementSnapshot[] = retryItems.map((item) => ({
    spec_book_item_id: item.spec_book_item_id,
    product_id: item.product_id,
    room_id: item.room_id,
    room_name: item.room_name,
    product_name: item.product_name,
    vendor: item.vendor,
    retailer_domain: item.retailer_domain,
    product_url: item.product_url,
    sku: item.sku,
    requested_quantity: item.requested_quantity,
    requested_options: item.requested_options,
    expected_price: item.expected_price,
    product_image_url: item.product_image_url,
    source_notes: item.source_notes,
  }));

  return createRunFromSnapshots({
    projectId: previous.project_id,
    userId: input.userId,
    snapshots,
    sourceRunId: previous.id,
    retryCounts,
  });
}

export async function reissueProcurementRunAccess(input: { runId: string; userId: string }) {
  const run = await getProcurementRunResult(input.runId);
  if (!run) throw new Error("Cart run not found.");
  if (run.created_by !== input.userId) {
    throw new Error("Only the person who prepared this run can refresh its access.");
  }
  if (["completed", "cancelled", "expired"].includes(run.status)) {
    throw new Error("Completed, cancelled, and expired runs cannot receive a new access token.");
  }

  const runAuthorization = generateRunAuthorization();
  const { error } = await admin
    .from("procurement_runs")
    .update({
      token_hash: hashRunAuthorization(runAuthorization),
      token_revoked_at: null,
      expires_at: procurementRunExpiry(),
      access_window_started_at: null,
      access_request_count: 0,
    })
    .eq("id", run.id);
  if (error) throw error;
  const refreshed = await getProcurementRunResult(run.id);
  if (!refreshed) throw new Error("Could not reload the refreshed run.");
  const prompt = buildProcurementPrompt({ runId: run.id, runAuthorization });
  return {
    run: refreshed,
    runAuthorization,
    prompt,
    deepLink: buildCodexDeepLink(prompt),
  } satisfies PreparedProcurementRun;
}

export async function closeProcurementRun(input: { runId: string; action: "cancel" | "expire" }) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("procurement_runs")
    .update({
      status: input.action === "expire" ? "expired" : "cancelled",
      cancelled_at: input.action === "cancel" ? now : null,
      expires_at: input.action === "expire" ? now : undefined,
      token_revoked_at: now,
    })
    .eq("id", input.runId)
    .in("status", ["prepared", "in_progress"]);
  if (error) throw error;
  return getProcurementRunResult(input.runId);
}

export async function authorizeProcurementRun(runAuthorization: string) {
  const tokenHash = hashRunAuthorization(asString(runAuthorization));
  const { data, error } = await admin.rpc("authorize_procurement_run", {
    p_token_hash: tokenHash,
    p_max_requests: 120,
    p_window_seconds: 60,
  });
  if (error) {
    if (String(error.message).includes("procurement_rate_limit_exceeded")) {
      const rateLimitError = new Error("Too many run requests. Wait a minute and try again.");
      (rateLimitError as Error & { code?: string }).code = "RATE_LIMITED";
      throw rateLimitError;
    }
    throw error;
  }
  const runId = data?.[0]?.run_id;
  if (!runId) {
    const unauthorized = new Error("Run authorization is invalid, expired, completed, or revoked.");
    (unauthorized as Error & { code?: string }).code = "UNAUTHORIZED_RUN";
    throw unauthorized;
  }
  const run = await getProcurementRunResult(runId);
  if (!run) throw new Error("Authorized cart run no longer exists.");
  return run;
}

export async function updateAuthorizedProcurementItem(input: {
  runAuthorization: string;
  runItemId: string;
  status: ProcurementItemStatus;
  observedProductTitle?: string | null;
  observedOptions?: Record<string, unknown> | null;
  observedPrice?: number | null;
  observedShipping?: number | null;
  observedStockStatus?: string | null;
  cartUrl?: string | null;
  resultNotes?: string | null;
}) {
  const run = await authorizeProcurementRun(input.runAuthorization);
  const item = run.items.find((candidate) => candidate.id === input.runItemId);
  if (!item) throw new Error("This item does not belong to the authorized cart run.");
  if (item.status === "added" && input.status !== "added") {
    throw new Error(
      "An Added item cannot be reopened through the MCP tool. Use Studio retry controls.",
    );
  }
  if (input.status === "drafted") {
    throw new Error("Drafted status can only be recorded by Studio's create_retailer_draft tool.");
  }

  const observedPrice = numeric(input.observedPrice);
  const observedShipping = numeric(input.observedShipping);
  if (input.status === "added" && item.product_id && observedPrice !== null) {
    const pricingUpdate: { unit_cost: string; shipping?: string } = {
      unit_cost: observedPrice.toFixed(2),
    };
    if (observedShipping !== null) pricingUpdate.shipping = observedShipping.toFixed(2);

    // Price sync happens before the run item is finalized so a failed product update
    // remains retryable instead of leaving an Added item with stale Studio pricing.
    const { error: pricingError } = await admin
      .from("products")
      .update(pricingUpdate)
      .eq("id", item.product_id);
    if (pricingError) throw pricingError;
  }

  const observedOptions = {
    ...(input.observedOptions ?? {}),
    ...(observedShipping !== null ? { shipping: observedShipping } : {}),
  };

  const { data: updated, error } = await admin
    .from("procurement_run_items")
    .update({
      status: input.status,
      observed_product_title: asNullableString(input.observedProductTitle),
      observed_options: observedOptions,
      observed_price: observedPrice,
      observed_availability: asNullableString(input.observedStockStatus),
      retailer_cart_url: asNullableString(input.cartUrl),
      result_notes: asNullableString(input.resultNotes),
    })
    .eq("id", input.runItemId)
    .eq("run_id", run.id)
    .select("*")
    .single();
  if (error) throw error;

  if (run.status === "prepared") {
    await admin
      .from("procurement_runs")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("status", "prepared");
  }
  return normalizeRunItem(updated);
}

export async function completeAuthorizedProcurementRun(runAuthorization: string) {
  const run = await authorizeProcurementRun(runAuthorization);
  const totals = {
    added: run.items.filter((item) => ["added", "completed"].includes(item.status)).length,
    drafted: run.items.filter((item) => item.status === "drafted").length,
    needs_review: run.items.filter((item) =>
      [
        "needs_review",
        "option_mismatch",
        "price_changed",
        "login_required",
        "captcha_required",
      ].includes(item.status),
    ).length,
    failed: run.items.filter((item) =>
      ["failed", "out_of_stock", "backordered", "unsupported_retailer"].includes(item.status),
    ).length,
    skipped: run.items.filter((item) => item.status === "skipped").length,
  };
  const now = new Date().toISOString();
  const { error } = await admin
    .from("procurement_runs")
    .update({
      status: "completed",
      completed_at: now,
      token_revoked_at: now,
    })
    .eq("id", run.id);
  if (error) throw error;
  return { run_id: run.id, status: "completed" as const, ...totals };
}
