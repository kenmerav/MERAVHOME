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
import { toast } from "sonner";

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
}: {
  projectId: string;
  roomId: string;
  roomName: string;
  label: string;
  existingItem: { id: string; updated_at: string } | null;
  disabled: boolean;
  onAdded: () => Promise<void>;
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
  const qc = useQueryClient();
  const isSink = /\bsinks?\b/i.test(label);
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
  const query = useQuery<{ suggestions: CatalogSuggestion[] }>({
    queryKey: ["materialCatalogSuggestions", projectId, roomId, label, filters],
    queryFn: () =>
      catalogRequest({
        project_id: projectId,
        room_id: roomId,
        label,
        action: "list",
        criteria: filters,
      }),
    enabled: open && !invalidWidth,
    staleTime: 30_000,
    retry: false,
  });
  const add = async (candidate: CatalogSuggestion) => {
    if (saving) return;
    setSaving(candidate.product.id);
    try {
      await catalogRequest({
        project_id: projectId,
        room_id: roomId,
        label,
        action: "add",
        product_id: candidate.product.id,
        existing_item_id: existingItem?.id ?? null,
        expected_updated_at: existingItem?.updated_at ?? null,
      });
      await onAdded();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["materialItems", projectId] }),
        qc.invalidateQueries({ queryKey: ["procurement"] }),
        qc.invalidateQueries({ queryKey: ["roomProducts", roomId] }),
        qc.invalidateQueries({ queryKey: ["spec-completion-review", projectId] }),
        qc.invalidateQueries({ queryKey: ["materialCatalogSuggestions"] }),
      ]);
      toast.success(`${label} added to ${roomName}. Confirm its quantity in Materials.`);
      setOpen(false);
    } catch (error) {
      await qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
      toast.error((error as Error).message);
    } finally {
      setSaving(null);
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
          Products used in this project appear first, followed by products used on other projects.
          Adding one keeps its saved catalog details; quantity will be TBD.
        </p>
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
                      disabled={!!saving || query.isFetching || filtersPending}
                      onClick={() => add(candidate)}
                      className="block mt-3 bg-ink px-4 py-2 text-xs text-primary-foreground disabled:opacity-50"
                    >
                      {saving === p.id ? "Adding…" : "Add from Catalog"}
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
