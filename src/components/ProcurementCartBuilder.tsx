import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  RefreshCw,
  ScanSearch,
  ShoppingCart,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { MaterialItem, Project, Room } from "@/lib/db";
import {
  buildProcurementDraft,
  calculateProcurementOrderQuantity,
  classifyProcurementDraft,
  hasPriceChanged,
  isRetryableStatus,
  itemStatusLabel,
  preflightLabel,
  summarizeRun,
  quantityUnitLabel,
  type ProcurementDraft,
  type ProcurementMethod,
  type ProcurementOptionKey,
  type ProcurementQuantityUnit,
  type ProcurementRunResult,
} from "@/lib/procurementCart";

type PreparedAccess = {
  run: ProcurementRunResult;
  runAuthorization: string;
  prompt: string;
  deepLink: string;
};

type DraftEmailConnection = {
  connected: boolean;
  account_email: string;
  status: string;
  capability: "draft_only";
  last_error: string | null;
};

async function authenticatedRequest(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to use Merav Cart Builder.");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "The cart-run request failed.");
    (error as Error & { runId?: string }).runId = body.run_id;
    throw error;
  }
  return body;
}

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function statusTone(status: string) {
  if (status === "ready" || status === "added" || status === "drafted" || status === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (
    status === "needs_review" ||
    status === "price_changed" ||
    status === "login_required" ||
    status === "captcha_required"
  ) {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  if (status === "excluded" || status === "skipped") {
    return "border-border bg-bone/50 text-muted-foreground";
  }
  return "border-red-300 bg-red-50 text-red-800";
}

export function ProcurementCartBuilder({
  project,
  rooms,
  items,
}: {
  project: Pick<Project, "id" | "name">;
  rooms: Room[];
  items: MaterialItem[];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<ProcurementDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [coverageScrapingIds, setCoverageScrapingIds] = useState<Set<string>>(new Set());
  const [preparedAccess, setPreparedAccess] = useState<PreparedAccess | null>(null);
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);

  useEffect(() => {
    setDrafts((current) => {
      const currentById = new Map(current.map((draft) => [draft.specBookItemId, draft]));
      return items
        .filter((item) => item.product_id && item.product)
        .map((item) => {
          const fresh = buildProcurementDraft(item, project, roomById.get(item.room_id), false);
          const existing = currentById.get(item.id);
          return existing ? { ...fresh, ...existing, sourceExcluded: fresh.sourceExcluded } : fresh;
        });
    });
  }, [items, project, roomById]);

  const runsQuery = useQuery({
    queryKey: ["procurementRuns", project.id],
    queryFn: async () => {
      const body = await authenticatedRequest(
        `/api/procurement-runs?projectId=${encodeURIComponent(project.id)}`,
      );
      return (body.runs ?? []) as ProcurementRunResult[];
    },
    enabled: open,
    refetchInterval: open ? 3_000 : false,
  });

  const draftEmailQuery = useQuery({
    queryKey: ["procurementEmailConnection"],
    queryFn: async () =>
      (await authenticatedRequest("/api/procurement-email")) as DraftEmailConnection,
    enabled: open,
    retry: false,
  });

  const classifiedDrafts = useMemo(
    () =>
      drafts.map((draft) => ({
        draft,
        status: classifyProcurementDraft(draft),
      })),
    [drafts],
  );
  const selected = classifiedDrafts.filter(({ draft }) => draft.selected);
  const selectedReady = selected.filter(({ status }) => status === "ready");
  const selectedBlocked = selected.filter(({ status }) => status !== "ready");
  const selectedEmailCount = selectedReady.filter(
    ({ draft }) => draft.procurementMethod === "email_rep",
  ).length;
  const draftEmailMissing = selectedEmailCount > 0 && !draftEmailQuery.data?.connected;

  const updateDraft = (id: string, patch: Partial<ProcurementDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.specBookItemId === id ? { ...draft, ...patch } : draft)),
    );
  };

  const scrapeCartonCoverage = async (draft: ProcurementDraft) => {
    if (coverageScrapingIds.has(draft.specBookItemId)) return;
    setCoverageScrapingIds((current) => new Set(current).add(draft.specBookItemId));
    try {
      const result = (await authenticatedRequest("/api/scrape-carton-coverage", {
        method: "POST",
        body: JSON.stringify({
          material_item_id: draft.specBookItemId,
          size: draft.size || draft.dimensions,
        }),
      })) as {
        carton_coverage_sq_ft: number | null;
        confidence: "exact" | "review" | "missing";
        source_url: string;
        evidence: string | null;
        message: string;
      };
      updateDraft(draft.specBookItemId, {
        cartonCoverageSquareFeet:
          result.confidence === "exact" ? result.carton_coverage_sq_ft : null,
        cartonCoverageConfidence: result.confidence,
        cartonCoverageSourceUrl: result.source_url,
        cartonCoverageSourceText: result.evidence ?? "",
      });
      await queryClient.invalidateQueries({ queryKey: ["materialItems", project.id] });
      if (result.confidence === "exact") toast.success(result.message);
      else toast.warning(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not find carton coverage. Enter it manually.",
      );
    } finally {
      setCoverageScrapingIds((current) => {
        const next = new Set(current);
        next.delete(draft.specBookItemId);
        return next;
      });
    }
  };

  const toggleRequired = (draft: ProcurementDraft, key: ProcurementOptionKey) => {
    const requiredOptionKeys = draft.requiredOptionKeys.includes(key)
      ? draft.requiredOptionKeys.filter((candidate) => candidate !== key)
      : [...draft.requiredOptionKeys, key];
    updateDraft(draft.specBookItemId, { requiredOptionKeys });
  };

  const selectAllReady = () => {
    setDrafts((current) =>
      current.map((draft) => {
        const candidate = { ...draft, selected: true };
        return {
          ...draft,
          selected: classifyProcurementDraft(candidate) === "ready",
        };
      }),
    );
  };

  const prepareRun = async () => {
    if (!selectedReady.length) return;
    setBusy(true);
    try {
      const body = (await authenticatedRequest("/api/procurement-runs", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          project_id: project.id,
          items: selectedReady.map(({ draft }) => ({
            spec_book_item_id: draft.specBookItemId,
            quantity: draft.quantity,
            quantity_unit: draft.quantityUnit,
            carton_coverage_sq_ft: draft.cartonCoverageSquareFeet,
            waste_percentage: draft.wastePercentage,
            color: draft.color,
            finish: draft.finish,
            size: draft.size,
            dimensions: draft.dimensions,
            other_requirements: draft.otherRequirements,
            substitution_instructions: draft.substitutionInstructions,
            required_option_keys: draft.requiredOptionKeys,
            procurement_method: draft.procurementMethod,
            rep_email: draft.repEmail,
          })),
        }),
      })) as PreparedAccess;
      setPreparedAccess(body);
      setDrafts((current) => current.map((draft) => ({ ...draft, selected: false })));
      await queryClient.invalidateQueries({ queryKey: ["procurementRuns", project.id] });
      toast.success("Secure cart run prepared.");
    } catch (error) {
      const value = error as Error & { runId?: string };
      toast.error(value.runId ? `${value.message} Open the existing run below.` : value.message);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: "retry" | "reissue", runId: string) => {
    setBusy(true);
    try {
      const body = (await authenticatedRequest("/api/procurement-runs", {
        method: "POST",
        body: JSON.stringify({ action, run_id: runId }),
      })) as PreparedAccess;
      setPreparedAccess(body);
      await queryClient.invalidateQueries({ queryKey: ["procurementRuns", project.id] });
      toast.success(
        action === "retry" ? "Unresolved products are ready to retry." : "Access refreshed.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the run.");
    } finally {
      setBusy(false);
    }
  };

  const closeRun = async (action: "cancel" | "expire", runId: string) => {
    setBusy(true);
    try {
      await authenticatedRequest("/api/procurement-runs", {
        method: "PATCH",
        body: JSON.stringify({ action, run_id: runId }),
      });
      if (preparedAccess?.run.id === runId) setPreparedAccess(null);
      await queryClient.invalidateQueries({ queryKey: ["procurementRuns", project.id] });
      toast.success(action === "expire" ? "Run expired and access revoked." : "Run cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not close the run.");
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    if (!preparedAccess) return;
    await navigator.clipboard.writeText(preparedAccess.prompt);
    toast.success("Codex prompt copied. Return to Codex, paste it into a task, and send.");
  };

  const connectDraftEmail = async () => {
    setBusy(true);
    try {
      const body = (await authenticatedRequest("/api/procurement-email", {
        method: "POST",
        body: JSON.stringify({
          action: "connect",
          return_to: `${window.location.pathname}${window.location.search}`,
        }),
      })) as { url: string };
      window.location.assign(body.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not connect draft email.");
      setBusy(false);
    }
  };

  return (
    <section className="print:hidden mb-8 border border-border bg-bone/20">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 p-5 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-primary-foreground">
            <ShoppingCart className="h-4 w-4" />
          </span>
          <span>
            <span className="eyebrow block">Private MVP</span>
            <span className="mt-1 block font-display text-2xl">Merav Cart Builder</span>
          </span>
        </span>
        {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
      </button>

      {open && (
        <div className="border-t border-border p-5 lg:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-sm leading-6 text-muted-foreground">
                Select purchase-ready Spec Book products, confirm exact requirements, then prepare a
                one-hour run. Choose Online cart for Codex and{" "}
                <span className="font-medium text-ink">@Chrome</span>, or Email rep to create a
                reviewable draft through Studio&apos;s draft-only email tool. Checkout, payment, and
                sending email always remain manual.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllReady}
                className="border border-border bg-white px-4 py-2 text-xs uppercase tracking-[0.14em]"
              >
                Select all ready
              </button>
              <button
                type="button"
                onClick={() =>
                  setDrafts((current) => current.map((draft) => ({ ...draft, selected: false })))
                }
                className="border border-border bg-white px-4 py-2 text-xs uppercase tracking-[0.14em]"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-border bg-white p-4">
            <div>
              <div className="text-sm font-medium">Ken&apos;s procurement draft email</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {draftEmailQuery.data?.connected
                  ? `${draftEmailQuery.data.account_email} is connected. Studio can create drafts but exposes no Send command.`
                  : "Connect ken@meravinteriors.com before running Email rep items. This is separate from Marvin's read-only email setup."}
              </p>
              {draftEmailQuery.isError && (
                <p className="mt-1 text-xs text-red-700">
                  {draftEmailQuery.error instanceof Error
                    ? draftEmailQuery.error.message
                    : "Draft email setup could not be loaded."}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={connectDraftEmail}
              disabled={busy}
              className="border border-border bg-white px-4 py-2 text-xs uppercase tracking-[0.14em] disabled:opacity-40"
            >
              {draftEmailQuery.data?.connected ? "Reconnect draft email" : "Connect draft email"}
            </button>
          </div>

          <div className="mt-6 overflow-x-auto border border-border bg-white">
            <table className="min-w-[1920px] w-full text-sm">
              <thead className="bg-bone/40 text-left">
                <tr className="border-b border-border">
                  <th className="p-3">Buy</th>
                  <th className="p-3">Product</th>
                  <th className="p-3">Method</th>
                  <th className="p-3">Rep email</th>
                  <th className="p-3">Qty</th>
                  <th className="p-3">Unit</th>
                  <th className="p-3">Carton sq ft</th>
                  <th className="p-3">Waste %</th>
                  <th className="p-3">Order qty</th>
                  <th className="p-3">Color</th>
                  <th className="p-3">Finish</th>
                  <th className="p-3">Size</th>
                  <th className="p-3">Dimensions</th>
                  <th className="p-3">Other requirements</th>
                  <th className="p-3">Preflight</th>
                </tr>
              </thead>
              <tbody>
                {classifiedDrafts.map(({ draft, status }) => (
                  <tr key={draft.specBookItemId} className="border-b border-border/70 align-top">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={draft.selected}
                        disabled={draft.sourceExcluded}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, { selected: event.target.checked })
                        }
                        className="h-4 w-4 accent-ink"
                        aria-label={`Select ${draft.productName}`}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex min-w-[230px] gap-3">
                        {draft.imageUrl ? (
                          <img
                            src={draft.imageUrl}
                            alt=""
                            className="h-12 w-12 border border-border object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-12 w-12 border border-border bg-bone/40" />
                        )}
                        <div>
                          <div className="font-medium">{draft.productName}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {draft.roomName} · {draft.vendor || "Vendor not saved"}
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {draft.sku ? `SKU ${draft.sku}` : "No SKU"} ·{" "}
                            {formatPrice(draft.expectedPrice)}
                          </div>
                          <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={draft.sourceNeedsReview}
                              onChange={(event) =>
                                updateDraft(draft.specBookItemId, {
                                  sourceNeedsReview: event.target.checked,
                                })
                              }
                              className="h-3.5 w-3.5 accent-ink"
                            />
                            Needs review
                          </label>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <select
                        value={draft.procurementMethod}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, {
                            procurementMethod: event.target.value as ProcurementMethod,
                          })
                        }
                        className="h-9 w-32 border border-input bg-white px-2 text-xs"
                        aria-label={`Purchasing method for ${draft.productName}`}
                      >
                        <option value="online_cart">Online cart</option>
                        <option value="email_rep">Email rep</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <input
                        type="email"
                        value={draft.repEmail}
                        disabled={draft.procurementMethod !== "email_rep"}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, { repEmail: event.target.value })
                        }
                        placeholder={
                          draft.procurementMethod === "email_rep" ? "rep@example.com" : "Not needed"
                        }
                        className="h-9 w-52 border border-input px-2 text-xs disabled:bg-bone/40 disabled:text-muted-foreground"
                        aria-label={`Representative email for ${draft.productName}`}
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={draft.quantity ?? ""}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, {
                            quantity: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        className="h-9 w-20 border border-input px-2"
                        aria-label={`Quantity needed for ${draft.productName}`}
                      />
                    </td>
                    <td className="p-3">
                      <select
                        value={draft.quantityUnit}
                        onChange={(event) => {
                          const quantityUnit = event.target.value as ProcurementQuantityUnit;
                          updateDraft(draft.specBookItemId, {
                            quantityUnit,
                          });
                          if (quantityUnit === "square_feet" && !draft.cartonCoverageSquareFeet) {
                            void scrapeCartonCoverage({ ...draft, quantityUnit });
                          }
                        }}
                        className="h-9 w-32 border border-input bg-white px-2 text-xs"
                        aria-label={`Quantity unit for ${draft.productName}`}
                      >
                        <option value="pieces">Pieces</option>
                        <option value="boxes">Boxes</option>
                        <option value="square_feet">Square feet</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        disabled={draft.quantityUnit !== "square_feet"}
                        value={draft.cartonCoverageSquareFeet ?? ""}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, {
                            cartonCoverageSquareFeet:
                              event.target.value === "" ? null : Number(event.target.value),
                            cartonCoverageConfidence: event.target.value === "" ? null : "manual",
                            cartonCoverageSourceUrl: "",
                            cartonCoverageSourceText:
                              event.target.value === "" ? "" : "Entered manually in Studio",
                          })
                        }
                        placeholder={draft.quantityUnit === "square_feet" ? "Required" : "—"}
                        className="h-9 w-24 border border-input px-2 disabled:bg-bone/40 disabled:text-muted-foreground"
                        aria-label={`Carton coverage for ${draft.productName}`}
                      />
                      {draft.quantityUnit === "square_feet" && (
                        <button
                          type="button"
                          onClick={() => scrapeCartonCoverage(draft)}
                          disabled={coverageScrapingIds.has(draft.specBookItemId)}
                          className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] underline disabled:opacity-50"
                        >
                          {coverageScrapingIds.has(draft.specBookItemId) ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <ScanSearch className="h-3 w-3" />
                          )}
                          {coverageScrapingIds.has(draft.specBookItemId)
                            ? "Checking website"
                            : "Find on website"}
                        </button>
                      )}
                      {draft.cartonCoverageConfidence && (
                        <div
                          className={`mt-1 max-w-36 text-[10px] leading-4 ${
                            draft.cartonCoverageConfidence === "exact"
                              ? "text-emerald-700"
                              : draft.cartonCoverageConfidence === "manual"
                                ? "text-muted-foreground"
                                : "text-amber-800"
                          }`}
                        >
                          {draft.cartonCoverageConfidence === "exact"
                            ? "Matched manufacturer packaging"
                            : draft.cartonCoverageConfidence === "manual"
                              ? "Entered manually"
                              : "Website result needs review"}
                          {draft.cartonCoverageSourceUrl && (
                            <>
                              {" · "}
                              <a
                                href={draft.cartonCoverageSourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                Source
                              </a>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        disabled={draft.quantityUnit !== "square_feet"}
                        value={draft.wastePercentage ?? ""}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, {
                            wastePercentage:
                              event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        placeholder="0"
                        className="h-9 w-20 border border-input px-2 disabled:bg-bone/40 disabled:text-muted-foreground"
                        aria-label={`Waste percentage for ${draft.productName}`}
                      />
                    </td>
                    <td className="p-3 text-xs leading-5">
                      {draft.quantity
                        ? (() => {
                            const order = calculateProcurementOrderQuantity({
                              quantity: draft.quantity,
                              quantityUnit: draft.quantityUnit,
                              cartonCoverageSquareFeet: draft.cartonCoverageSquareFeet,
                              wastePercentage: draft.wastePercentage,
                            });
                            return (
                              <>
                                <div className="font-medium">
                                  {order.quantity} {quantityUnitLabel(order.unit, order.quantity)}
                                </div>
                                {order.coveredSquareFeet !== null && (
                                  <div className="text-muted-foreground">
                                    {order.coveredSquareFeet.toFixed(2)} sq ft coverage
                                  </div>
                                )}
                              </>
                            );
                          })()
                        : "—"}
                    </td>
                    {(["color", "finish", "size", "dimensions"] as ProcurementOptionKey[]).map(
                      (key) => (
                        <td key={key} className="p-3">
                          <input
                            value={draft[key]}
                            onChange={(event) =>
                              updateDraft(draft.specBookItemId, { [key]: event.target.value })
                            }
                            className="h-9 w-32 border border-input px-2"
                          />
                          <label className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={draft.requiredOptionKeys.includes(key)}
                              onChange={() => toggleRequired(draft, key)}
                              className="h-3 w-3 accent-ink"
                            />
                            Required
                          </label>
                        </td>
                      ),
                    )}
                    <td className="p-3">
                      <textarea
                        value={draft.otherRequirements}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, {
                            otherRequirements: event.target.value,
                          })
                        }
                        placeholder="Exact option details"
                        className="min-h-16 w-44 border border-input p-2 text-xs"
                      />
                      <textarea
                        value={draft.substitutionInstructions}
                        onChange={(event) =>
                          updateDraft(draft.specBookItemId, {
                            substitutionInstructions: event.target.value,
                          })
                        }
                        placeholder="Substitution only if explicitly allowed"
                        className="mt-2 min-h-16 w-44 border border-input p-2 text-xs"
                      />
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusTone(status)}`}
                      >
                        {preflightLabel(status)}
                      </span>
                      {draft.productUrl ? (
                        <a
                          href={draft.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 flex items-center gap-1 text-xs underline"
                        >
                          Review link <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-border bg-white p-4">
            <div className="text-sm">
              <span className="font-medium">{selectedReady.length} Ready</span>
              <span className="text-muted-foreground"> will be included</span>
              {selectedEmailCount > 0 && (
                <span className="ml-3 text-muted-foreground">
                  {selectedEmailCount} will be drafted to rep email
                </span>
              )}
              {draftEmailMissing && (
                <span className="ml-3 text-amber-800">Connect Ken&apos;s draft email first</span>
              )}
              {selectedBlocked.length > 0 && (
                <span className="ml-3 text-amber-800">
                  {selectedBlocked.length} selected item{selectedBlocked.length === 1 ? "" : "s"}{" "}
                  blocked
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={prepareRun}
              disabled={busy || !selectedReady.length || draftEmailMissing}
              className="inline-flex items-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Prepare Cart Run
            </button>
          </div>

          {preparedAccess && (
            <div className="mt-6 border border-emerald-300 bg-emerald-50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="eyebrow text-emerald-800">Run prepared</div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-950">
                    The prompt includes one-hour run authorization. Copy it, return to Codex, paste
                    it into a task, and press Send. Codex uses Merav Cart Builder, @Chrome, and
                    Studio&apos;s dedicated draft-only email tool. Nothing starts checkout or sends
                    an email.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreparedAccess(null)}
                  className="text-emerald-900"
                  aria-label="Dismiss prepared run"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 rounded border border-emerald-300 bg-white p-3 text-xs leading-5 text-ink">
                {preparedAccess.prompt}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="inline-flex items-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground"
                >
                  <Copy className="h-4 w-4" /> Copy for Codex
                </button>
              </div>
            </div>
          )}

          <div className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="eyebrow">Live results</div>
                <h3 className="mt-2 font-display text-3xl">Cart Runs</h3>
              </div>
              <button
                type="button"
                onClick={() => runsQuery.refetch()}
                className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em]"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>
            {runsQuery.isLoading ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading runs…</p>
            ) : runsQuery.data?.length ? (
              <div className="mt-4 space-y-4">
                {runsQuery.data.map((run) => (
                  <RunResults
                    key={run.id}
                    run={run}
                    busy={busy}
                    onRetry={() => runAction("retry", run.id)}
                    onReissue={() => runAction("reissue", run.id)}
                    onCancel={() => closeRun("cancel", run.id)}
                    onExpire={() => closeRun("expire", run.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                No cart runs have been prepared for this project.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function RunResults({
  run,
  busy,
  onRetry,
  onReissue,
  onCancel,
  onExpire,
}: {
  run: ProcurementRunResult;
  busy: boolean;
  onRetry: () => void;
  onReissue: () => void;
  onCancel: () => void;
  onExpire: () => void;
}) {
  const [expanded, setExpanded] = useState(run.status === "in_progress");
  const summary = summarizeRun(run.items);
  const completed = run.items.length - summary.remaining;
  const progress = run.items.length ? Math.round((completed / run.items.length) * 100) : 0;
  const grouped = useMemo(() => {
    const groups = new Map<string, ProcurementRunResult["items"]>();
    run.items.forEach((item) => {
      const current = groups.get(item.retailer_domain) ?? [];
      current.push(item);
      groups.set(item.retailer_domain, current);
    });
    return Array.from(groups.entries());
  }, [run.items]);
  const unresolved = run.items.filter((item) => isRetryableStatus(item.status)).length;
  const active = run.status === "prepared" || run.status === "in_progress";

  return (
    <article className="border border-border bg-white">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-4 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">
              {new Date(run.created_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusTone(
                run.status === "completed" ? "completed" : run.status,
              )}`}
            >
              {run.status.replace("_", " ")}
            </span>
            <span className="text-xs text-muted-foreground">
              {completed}/{run.items.length} complete · {unresolved} unresolved
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bone">
            <div className="h-full bg-ink transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {expanded && (
        <div className="border-t border-border p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {unresolved > 0 && (
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                className="border border-border px-3 py-2 text-xs"
              >
                Retry unresolved only
              </button>
            )}
            {active && (
              <>
                <button
                  type="button"
                  onClick={onReissue}
                  disabled={busy}
                  className="border border-border px-3 py-2 text-xs"
                >
                  Refresh one-hour access
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="border border-border px-3 py-2 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onExpire}
                  disabled={busy}
                  className="border border-border px-3 py-2 text-xs"
                >
                  Expire now
                </button>
              </>
            )}
          </div>
          <div className="space-y-5">
            {grouped.map(([retailer, retailerItems]) => (
              <section key={retailer}>
                <h4 className="eyebrow mb-2">{retailer}</h4>
                <div className="divide-y divide-border border border-border">
                  {retailerItems.map((item) => {
                    const priceChanged = hasPriceChanged(item.expected_price, item.observed_price);
                    const procurementMethod =
                      item.requested_options.procurement_method ?? "online_cart";
                    const quantityUnit = item.requested_options.quantity_unit ?? "pieces";
                    const orderQuantity = calculateProcurementOrderQuantity({
                      quantity: item.requested_quantity,
                      quantityUnit,
                      cartonCoverageSquareFeet: item.requested_options.carton_coverage_sq_ft,
                      wastePercentage: item.requested_options.waste_percentage,
                    });
                    const displayStatus =
                      procurementMethod === "email_rep" && item.status === "skipped"
                        ? "drafted"
                        : item.status;
                    return (
                      <div
                        key={item.id}
                        className="grid gap-3 p-3 md:grid-cols-[64px_minmax(0,1.3fr)_minmax(0,1fr)_auto]"
                      >
                        {item.product_image_url ? (
                          <img
                            src={item.product_image_url}
                            alt=""
                            className="h-16 w-16 border border-border object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-16 w-16 border border-border bg-bone/40" />
                        )}
                        <div>
                          <div className="font-medium">{item.product_name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{item.room_name}</div>
                          <div className="mt-2 text-xs leading-5">
                            Needed {item.requested_quantity}{" "}
                            {quantityUnitLabel(quantityUnit, item.requested_quantity)}
                            {quantityUnit === "square_feet" && (
                              <span className="ml-2 font-medium">
                                · Order {orderQuantity.quantity}{" "}
                                {quantityUnitLabel(orderQuantity.unit, orderQuantity.quantity)}
                              </span>
                            )}
                            {Object.entries(item.requested_options)
                              .filter(
                                ([key, value]) =>
                                  value &&
                                  ![
                                    "procurement_method",
                                    "rep_email",
                                    "quantity_unit",
                                    "carton_coverage_sq_ft",
                                    "waste_percentage",
                                  ].includes(key),
                              )
                              .map(([key, value]) => (
                                <span key={key} className="ml-2">
                                  · {key.replaceAll("_", " ")}: {String(value)}
                                </span>
                              ))}
                          </div>
                          {(item.requested_options.carton_coverage_sq_ft != null ||
                            item.requested_options.waste_percentage != null) && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {item.requested_options.carton_coverage_sq_ft != null
                                ? `${item.requested_options.carton_coverage_sq_ft} sq ft per carton`
                                : "Carton coverage not set"}
                              {item.requested_options.waste_percentage != null
                                ? ` · ${item.requested_options.waste_percentage}% waste`
                                : ""}
                            </div>
                          )}
                          {procurementMethod === "email_rep" && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Email rep: {item.requested_options.rep_email}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-3 text-xs">
                            <a
                              href={item.product_url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              Open Product
                            </a>
                            {item.retailer_cart_url && (
                              <a
                                href={item.retailer_cart_url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                Open Cart
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="text-xs leading-5">
                          <div>
                            Expected {formatPrice(item.expected_price)} · Observed{" "}
                            <span className={priceChanged ? "font-semibold text-amber-800" : ""}>
                              {formatPrice(item.observed_price)}
                            </span>
                          </div>
                          {item.observed_product_title && (
                            <div className="mt-1 text-muted-foreground">
                              Observed: {item.observed_product_title}
                            </div>
                          )}
                          {Object.keys(item.observed_options ?? {}).length > 0 && (
                            <div className="mt-1 text-muted-foreground">
                              Options: {JSON.stringify(item.observed_options)}
                            </div>
                          )}
                          {item.observed_availability && (
                            <div className="mt-1 text-muted-foreground">
                              Stock: {item.observed_availability}
                            </div>
                          )}
                          {item.result_notes && <div className="mt-2">{item.result_notes}</div>}
                        </div>
                        <div>
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusTone(
                              displayStatus,
                            )}`}
                          >
                            {itemStatusLabel(displayStatus)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
