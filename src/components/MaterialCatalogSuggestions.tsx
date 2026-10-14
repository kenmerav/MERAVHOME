import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { formatPriceWithUnit } from "@/lib/productPriceUnit";
import type { CatalogSuggestion, SinkMount } from "@/lib/materialCatalogSuggestions";
import type { PublicCatalogPlanFit, CoordinationSource } from "@/lib/materialCatalogFit";
import { isNominalFitRequirement } from "@/lib/materialCatalogFit";
import { toast } from "sonner";
import type { SavedCompletionIssue } from "@/lib/savedSpecCompletion";
import { completionCatalogTemplate } from "@/lib/specCompletionCatalog";
import { refreshCatalogSelectionIfNeeded } from "@/lib/catalogProductRefresh";
import { inferMaterialCategory } from "@/lib/roomTemplates";

async function catalogRequest(body: unknown) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to use catalog suggestions.");
  const response = await fetch("/api/material-catalog-suggestions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "Could not read catalog results. Please retry." }));
  if (!response.ok) throw new Error(result.error || "Could not load catalog suggestions.");
  return result;
}

export function MaterialCatalogSuggestions({
  projectId,
  roomId,
  roomName,
  label,
  existingItem,
  disabled,
  onAdded,
  completionIssue,
  replace = false,
  considerShared = false,
}: {
  projectId: string;
  roomId: string;
  roomName: string;
  label: string;
  existingItem: { id: string; updated_at: string } | null;
  disabled: boolean;
  onAdded: () => Promise<void>;
  completionIssue?: SavedCompletionIssue;
  replace?: boolean;
  considerShared?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [width, setWidth] = useState("");
  const [mount, setMount] = useState<SinkMount>("any");
  const [filters, setFilters] = useState({
    search: "",
    width: null as number | null,
    mount: "any" as SinkMount,
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState("");
  const [rechecking, setRechecking] = useState(false);
  const qc = useQueryClient();
  const searchLabel = completionIssue ? completionCatalogTemplate(label).label : label;
  const isSink = /\bsinks?\b/i.test(searchLabel);
  const invalidWidth =
    width.trim() !== "" &&
    (!Number.isFinite(Number(width)) || Number(width) <= 0 || Number(width) > 200);
  const filtersPending =
    search.trim() !== filters.search ||
    mount !== filters.mount ||
    (width.trim() ? Number(width) : null) !== filters.width;
  useEffect(() => {
    if (invalidWidth) return;
    const timeout = setTimeout(
      () =>
        setFilters({ search: search.trim(), width: width.trim() ? Number(width) : null, mount }),
      300,
    );
    return () => clearTimeout(timeout);
  }, [search, width, mount, invalidWidth]);
  const issueRequest = { consider_shared: considerShared, ...(completionIssue ? { completion_issue_key: completionIssue.key,
    expected_issue_updated_at: completionIssue.status_updated_at, existing_item_id: existingItem?.id ?? null } : {}) };
  const queryKey = ["materialCatalogSuggestions", projectId, roomId, label, completionIssue?.key, existingItem?.updated_at, filters];
  const query = useQuery<{
    suggestions: CatalogSuggestion[];
    context_key: string;
    context: {
      plan: PublicCatalogPlanFit;
      related: CoordinationSource[];
      excluded_conflicts: number;
    };
  }>({
    queryKey,
    queryFn: () =>
      catalogRequest({
        project_id: projectId,
        room_id: roomId,
        label,
        action: "list",
        criteria: filters,
        ...issueRequest,
      }),
    enabled: open && !invalidWidth,
    staleTime: 30_000,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.context?.plan.status === "checking" ? 5000 : false,
  });
  const context = query.data?.context;
  const plan = context?.plan;
  const recheckPlans = async () => {
    setRechecking(true);
    try {
      const result = await catalogRequest({
        project_id: projectId,
        room_id: roomId,
        label,
        action: "list",
        criteria: filters,
        refresh_plan: true,
        ...issueRequest,
      });
      qc.setQueryData(queryKey, result);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRechecking(false);
    }
  };
  const add = async (candidate: CatalogSuggestion) => {
    if (saving) return;
    setSaving(candidate.product.id);
    setSaveProgress("Saving catalog selection…");
    let productSaved = false;
    try {
      const result = await catalogRequest({
        project_id: projectId,
        room_id: roomId,
        label,
        action: replace ? "replace" : "add",
        product_id: candidate.product.id,
        expected_product_updated_at: candidate.product.updated_at,
        existing_item_id: existingItem?.id ?? null,
        expected_updated_at: existingItem?.updated_at ?? null,
        context_key: query.data?.context_key,
        ...issueRequest,
      });
      productSaved = true;
      const refreshWarning = await refreshCatalogSelectionIfNeeded({ projectId, itemId: result.item_id, product: candidate.product,
        material: { item_label: label, category: inferMaterialCategory(label), color: candidate.product.finish }, onProgress: setSaveProgress });
      await onAdded();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["materialItems", projectId] }),
        qc.invalidateQueries({ queryKey: ["procurement"] }),
        qc.invalidateQueries({ queryKey: ["roomProducts", roomId] }),
        qc.invalidateQueries({ queryKey: ["spec-completion-review", projectId] }),
        qc.invalidateQueries({ queryKey: ["materialCatalogSuggestions"] }),
        qc.invalidateQueries({ queryKey: ["catalog"] }),
        qc.invalidateQueries({ queryKey: ["products"] }),
        qc.invalidateQueries({ queryKey: ["product", candidate.product.id] }),
      ]);
      if (result.warning || refreshWarning) toast.warning(result.warning || refreshWarning);
      else toast.success(replace ? `${label} updated in Materials and the Spec Book.` : `${label} added to ${roomName}. Confirm its quantity in Materials.`);
      setOpen(false);
    } catch (error) {
      await qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
      await qc.invalidateQueries({ queryKey: ["materialCatalogSuggestions", projectId, roomId] });
      if (productSaved) { toast.warning("The product is saved to Materials and the Spec Book. Reopen the review to see the latest results."); setOpen(false); }
      else toast.error((error as Error).message);
    } finally {
      setSaving(null);
      setSaveProgress("");
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="border border-border px-3 py-2 text-xs hover:border-ink disabled:opacity-50"
        >
          Suggest from Catalog
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            Choose {label.toLowerCase()} for {roomName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Suggestions consider the latest plans, this room’s selections, and previous catalog use.
          {replace ? "Choosing one updates Materials and the Spec Book, keeps the quantity, and uses the catalog product’s saved details." : "Adding one keeps its saved catalog details; quantity will be TBD."}
          {" "}Missing images, prices, dimensions and colors are filled automatically from its product link when available.
        </p>
        {plan && context && (
          <div role="status" className="border border-border bg-muted/20 p-3 text-sm space-y-2">
            <p>{plan.message}</p>
            {plan.document && (
              <a href={`/projects/${projectId}/construction-docs`} className="text-xs underline">
                {plan.document.title} ↗
              </a>
            )}
            {plan.requirements
              .filter(
                (r, index, all) =>
                  r.label === searchLabel &&
                  (!isNominalFitRequirement(r) ||
                    all.findIndex(
                      (other) =>
                        other.label === searchLabel &&
                        other.value === r.value &&
                        isNominalFitRequirement(other),
                    ) === index),
              )
              .map((r) => (
                <div key={r.field} className="text-xs leading-relaxed">
                  <strong>
                    {isNominalFitRequirement(r)
                      ? "Advertised product size"
                      : r.field.replaceAll("_", " ")}
                    : {r.value}
                    {typeof r.value === "number" ? " in" : ""}
                  </strong>{" "}
                  · page {r.page}
                  {r.sheet ? ` · ${r.sheet}` : ""}
                  <p className="text-muted-foreground">{r.evidence}</p>
                </div>
              ))}
            {plan.status === "checking" && (
              <p className="text-xs text-muted-foreground">
                Keep this dialog open until the plan results are saved.
              </p>
            )}
            {plan.status === "unavailable" && (
              <button
                type="button"
                disabled={rechecking}
                onClick={() => void recheckPlans()}
                className="text-xs underline"
              >
                {rechecking ? "Starting plan check…" : "Check plans again"}
              </button>
            )}
            {context.related.length > 0 && (
              <div className="text-xs">
                <p className="font-medium">Comparing with this room’s plumbing:</p>
                {context.related.slice(0, 6).map((source) => (
                  <p key={source.item_id}>
                    {source.label}: {source.finish}
                  </p>
                ))}
              </div>
            )}
            {!!context.excluded_conflicts && (
              <p className="text-xs">
                {context.excluded_conflicts} catalog{" "}
                {context.excluded_conflicts === 1 ? "product excluded" : "products excluded"}{" "}
                because recorded specifications conflict with the plans.
              </p>
            )}
          </div>
        )}
        <Input
          aria-label={`Search catalog for ${label}`}
          placeholder="Search name, vendor, finish or SKU"
          value={search}
          disabled={!!saving}
          onChange={(event) => setSearch(event.target.value)}
        />
        {isSink && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              Mounting type
              <select
                aria-label="Sink mounting type"
                value={mount}
                disabled={!!saving}
                onChange={(event) => setMount(event.target.value as SinkMount)}
                className="block w-full border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="any">Any mounting type</option>
                <option value="wall">Wall-mounted</option>
                <option value="undermount">Undermount</option>
                <option value="vessel">Vessel</option>
                <option value="drop_in">Drop-in</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              Required overall width, inches (optional)
              <Input
                aria-label="Required sink width in inches"
                inputMode="decimal"
                placeholder="For example: 20"
                value={width}
                disabled={!!saving}
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Use an explicit sink width from the plans. Vanity width does not establish sink size.
              Width matches are within ½ inch; depth, mounting, cutout and plumbing still need
              confirmation.
            </p>
          </div>
        )}
        {invalidWidth && (
          <p role="alert" className="text-sm text-red-700">
            Enter a width greater than 0 and no more than 200 inches.
          </p>
        )}
        {query.isFetching && (
          <p role="status" className="text-sm text-muted-foreground">
            Finding catalog suggestions…
          </p>
        )}
        {saving && <p role="status" className="text-sm text-muted-foreground">{saveProgress}</p>}
        {query.error && (
          <div role="alert">
            <p className="text-sm">{query.error.message}</p>
            <button
              type="button"
              className="mt-2 underline text-sm"
              onClick={() => query.refetch()}
            >
              Try again
            </button>
          </div>
        )}
        {!query.isFetching && !query.error && query.data?.suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No catalog products match these filters. Try another mounting type or width, or add your
            own product link in Materials.
          </p>
        )}
        {!invalidWidth && (
          <div className="space-y-3">
            {query.data?.suggestions.map((candidate) => {
              const p = candidate.product;
              const image = normalizeSupabaseImageUrl(p.image_url);
              return (
                <div key={p.id} className="border border-border p-4 flex gap-4 items-start">
                  {image ? (
                    <img
                      src={image}
                      alt={p.name}
                      loading="lazy"
                      className="h-20 w-20 shrink-0 object-contain bg-muted/20"
                    />
                  ) : (
                    <div className="h-20 w-20 shrink-0 bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">
                      No image
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-lg font-medium leading-tight">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.vendor || "Vendor not recorded"}
                    </p>
                    <p className="text-sm">
                      {p.finish || "Finish not recorded"} ·{" "}
                      {p.price ? formatPriceWithUnit(p.price, p.price_unit) : "Price not recorded"}
                    </p>
                    <p className="text-sm">
                      {p.dimensions || p.selected_size || "Dimensions not recorded"}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {candidate.reason}
                    </p>
                    {candidate.fit && (
                      <div className="text-xs space-y-1 pt-2">
                        <p
                          className={`font-medium ${candidate.fit.status === "matches_recorded_requirements" ? "text-emerald-800" : "text-amber-900"}`}
                        >
                          {candidate.fit.status === "matches_recorded_requirements"
                            ? "Matches stated plan requirements"
                            : "Fit needs review"}
                        </p>
                        {candidate.fit.notes.map((note) => (
                          <p key={note} className="text-muted-foreground leading-relaxed">
                            {note}
                          </p>
                        ))}
                      </div>
                    )}
                    {p.product_url && /^https?:\/\//i.test(p.product_url) && (
                      <a
                        href={p.product_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-xs underline"
                      >
                        Product link ↗
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={
                        !!saving ||
                        query.isFetching ||
                        filtersPending ||
                        rechecking ||
                        plan?.status === "checking"
                      }
                      onClick={() => add(candidate)}
                      className="block mt-3 bg-ink px-4 py-2 text-xs text-primary-foreground disabled:opacity-50"
                    >
                      {saving === p.id ? saveProgress.startsWith("Saving catalog") ? "Saving…" : "Getting product info…" : replace ? "Use this product" : "Add from Catalog"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
