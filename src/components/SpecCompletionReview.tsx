import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Loader2, ArrowUpRight, ImageOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchSpecCompletion, fetchBoardColorSuggestion, fetchPlanDimensionSuggestion, fetchSavedSpecCompletion, updateCompletionIssue } from "@/lib/specCompletionClient";
import type { BoardColorSuggestion } from "@/lib/boardColorSuggestion";
import type { PlanDimensionSuggestion } from "@/lib/planDimensionSuggestion";
import { checkSpecDetails, completionItems, type CompletionRoom, type CompletionFinding, type SpecCompletionReport } from "@/lib/specCompletion";
import type { MaterialItem } from "@/lib/db";
import { completionIssueCounts, type SavedCompletionIssue, type CompletionIssueStatus } from "@/lib/savedSpecCompletion";
import { completionSolution, completionProductLink, completionMaterialsLink } from "@/lib/specCompletionPresentation";
import { saveCompletionDetail } from "@/lib/specCompletionClient";
import type { CompletionDetailDraft } from "@/lib/specCompletionDetail";
import { hasCompletionValue, needsCompletionColor } from "@/lib/specCompletion";
import { materialPriceUnit } from "@/lib/productPriceUnit";
import type { MaterialProductRefresh } from "@/lib/materialProductRefresh";
import type { SpecBoardSyncSummary } from "@/lib/specBoardSync";
import { MaterialCatalogSuggestions } from "@/components/MaterialCatalogSuggestions";
import { SpecCompletionPossibleItems } from "@/components/SpecCompletionPossibleItems";
import { untouchedCatalogPlaceholder } from "@/lib/materialCatalogSuggestions";
import { completionCatalogTemplate } from "@/lib/specCompletionCatalog";

const fieldLabels: Record<CompletionFinding["field"], string> = {
  quantity: "Quantity", color: "Color / finish", finish: "Finish", dimensions: "Dimensions",
  price: "Price", price_unit: "Price basis", product: "Product assignment", link: "Product link", missing_item: "Missing item",
};

type CompletionReviewProps = { projectId: string; items: MaterialItem[]; rooms: CompletionRoom[] };
export function SpecCompletionReview(props: CompletionReviewProps) {
  return <SpecCompletionReviewContent key={props.projectId} {...props} />;
}
function SpecCompletionReviewContent({ projectId, items, rooms }: CompletionReviewProps) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState("");
  const [productRefresh, setProductRefresh] = useState<MaterialProductRefresh | null>(null);
  const [boardRefresh, setBoardRefresh] = useState<SpecBoardSyncSummary | null>(null);
  const [report, setReport] = useState<SpecCompletionReport | null>(null);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const reviewKey = ["spec-completion-review", projectId];
  const savedQuery = useQuery({ queryKey: reviewKey, queryFn: () => fetchSavedSpecCompletion(projectId), staleTime: 30000, retry: false,
    refetchInterval: query => query.state.data?.report.plan_status === "checking" ? 5000 : false,
    refetchIntervalInBackground: true });
  const pending = savedQuery.data?.report.plan_status === "checking";
  const busy = checking || pending;
  const [viewSaved, setViewSaved] = useState(false);
  const [savingIssue, setSavingIssue] = useState("");
  const statusLock = useRef(false);
  const lock = useRef(false);
  const [reviewedSignature, setReviewedSignature] = useState("");
  const signature = JSON.stringify([projectId, rooms, items.map(item => [item.id, item.updated_at, item.product?.updated_at, item.quantity, item.quantity_tbd, item.quantity_unit, item.color, item.not_needed])]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const run = async () => {
    if (lock.current || pending) return;
    lock.current = true;
    setOpen(true); setChecking(true); setError(""); setReport(null); setViewSaved(false);
    setProgress("Sending the full design board to Materials…"); setProductRefresh(null); setBoardRefresh(null);
    setReviewedSignature(signature);
    try {
      setReport(await fetchSpecCompletion(projectId, {
        onProgress: setProgress,
        onBoardRefreshed: async summary => {
          setBoardRefresh(summary);
          await Promise.all([["designBoard", projectId], ["materialItems", projectId], ["procurement"]]
            .map(queryKey => qc.invalidateQueries({ queryKey })));
        },
        onProductsRefreshed: async summary => {
          setProductRefresh(summary);
          await Promise.all([["materialItems", projectId], ["products"], ["catalog"], ["procurement"], ["roomProducts"], ["designBoard", projectId]]
            .map(queryKey => qc.invalidateQueries({ queryKey })));
        },
      }));
      await savedQuery.refetch({ throwOnError: true }); setViewSaved(true);
      setReviewedSignature(currentSignature.current);
    }
    catch (error) {
      setError(error instanceof Error ? error.message : "Could not check completion.");
      // Earlier product batches can be saved even if a later batch fails.
      await Promise.all([["materialItems", projectId], ["products"], ["catalog"], ["procurement"], ["roomProducts"], ["designBoard", projectId]]
        .map(queryKey => qc.invalidateQueries({ queryKey })));
    }
    finally {
      lock.current = false; setChecking(false); setProgress("");
      // The pre-check may have added PDFs; refresh any open project document lists.
      void qc.invalidateQueries({ queryKey: ["projectDocuments", projectId] });
      void qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
    }
  };
  const openSaved = async () => {
    setOpen(true); setViewSaved(true); setError(""); setProductRefresh(null); setBoardRefresh(null); setReviewedSignature(signature);
    try { await savedQuery.refetch({ throwOnError: true }); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not load the saved review."); }
  };
  const changeStatus = async (issue: SavedCompletionIssue, status: CompletionIssueStatus) => {
    if (statusLock.current) return;
    statusLock.current = true; setSavingIssue(issue.key); setError("");
    try { qc.setQueryData(reviewKey, await updateCompletionIssue(projectId, issue, status)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save the issue status."); }
    finally { statusLock.current = false; setSavingIssue(""); }
  };
  const saveDetail = async (issue: SavedCompletionIssue, item: MaterialItem, draft: CompletionDetailDraft) => {
    if (statusLock.current) throw new Error("Another issue is saving. Please wait.");
    statusLock.current = true; setSavingIssue(issue.key); setError("");
    let detailSaved = false;
    try {
      const result = await saveCompletionDetail(projectId, item, issue, draft);
      const updated = result.item;
      detailSaved = true;
      await qc.cancelQueries({ queryKey: ["materialItems", projectId] });
      qc.setQueriesData<MaterialItem[]>({ queryKey: ["materialItems", projectId] }, current => current?.map(row => row.id === updated.id ? updated : row));
      if (updated.product) qc.setQueryData(["product", updated.product.id], updated.product);
      qc.setQueryData(reviewKey, result.review);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save this detail.";
      throw new Error(detailSaved ? `The detail is saved. The issue could not be marked completed: ${message}` : message);
    } finally {
      statusLock.current = false; setSavingIssue("");
      for (const queryKey of [["materialItems", projectId], ["procurement"], ["catalog"], ["products"], ["roomProducts", item.room_id], reviewKey])
        void qc.invalidateQueries({ queryKey });
    }
  };
  const saved = viewSaved ? savedQuery.data : null;
  const activeReport = saved?.report ?? report;
  const boardIssues = (activeReport?.board_refresh || boardRefresh)?.issues || [];
  const details = activeReport?.findings ?? (checking || error ? [] : checkSpecDetails(items, rooms));
  const count = savedQuery.data ? completionIssueCounts(savedQuery.data.issues).open : 0;
  return <>
    {savedQuery.data && <button type="button" onClick={() => void openSaved()} disabled={checking || !!savingIssue}
      className="inline-flex items-center gap-2 border px-5 py-2.5 text-sm print:hidden disabled:opacity-60">Saved completion review · {count} open</button>}
    <button type="button" onClick={() => void run()} disabled={busy}
      title="Send the full design board to Materials, scrape pricing, dimensions and color, then run the spec check"
      className="inline-flex items-center gap-2 border border-ink px-5 py-2.5 text-sm text-ink disabled:opacity-60 print:hidden">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
      {busy ? progress || "Checking Spec Book…" : "Check Spec Book for Completion"}
    </button>
    {savedQuery.error && <p className="text-xs text-muted-foreground print:hidden">{savedQuery.error.message}</p>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Spec Book completion review</DialogTitle>
          <DialogDescription>Send the full design board to Materials and the Spec Book, scrape pricing, dimensions and color, then run the spec check.</DialogDescription>
        </DialogHeader>
        {productRefresh && <p className="text-xs text-muted-foreground">Product info refreshed: {productRefresh.saved} saved{productRefresh.failed ? `; ${productRefresh.failed} products could not be refreshed and were reviewed using their saved details` : ""}.</p>}
        {(boardRefresh || activeReport?.board_refresh) && <div className="text-xs text-muted-foreground">
          <p>{(boardRefresh || activeReport?.board_refresh)?.status === "not_present" ? "No saved design board is attached." : `Full board sent to Materials${boardRefresh?.imported ? ` · ${boardRefresh.imported} selections added` : ""}${boardRefresh?.updated ? ` · ${boardRefresh.updated} selections updated` : ""}.`}</p>
          {!!boardIssues.length && <details className="mt-2" open>
            <summary className="cursor-pointer text-amber-800">{boardIssues.length} board items still need review</summary>
            <ul className="mt-2 max-h-32 overflow-auto space-y-1">{boardIssues.map((issue, index) =>
              <li key={index}>{issue.page} · {issue.label}: {issue.message}</li>)}</ul>
          </details>}
        </div>}
        <SpecCompletionResults key={reviewedSignature + (activeReport?.checked_at ?? "pending")} projectId={projectId} rooms={rooms} items={items} findings={details}
          issues={saved?.issues} onStatusChange={saved ? changeStatus : undefined} savingIssue={savingIssue}
          onSaveDetail={saved && !busy ? saveDetail : undefined}
          onSuggestionSaved={saved ? () => { void qc.invalidateQueries({ queryKey: reviewKey }); } : undefined}
          itemCount={activeReport?.item_count ?? completionItems(items).length} checking={busy || (viewSaved && savedQuery.isFetching && !saved)}
          planStatus={activeReport?.plan_status} document={activeReport?.document ?? null}
          checkedAt={activeReport?.checked_at}
          message={error || progress || activeReport?.plan_message || (viewSaved ? "Loading the saved review…" : "Sending the full board to Materials, scraping product info, then running the spec check…")}
          documentRefresh={activeReport?.document_refresh}
          stale={!checking && (!!saved?.stale || reviewedSignature !== signature)} />
        <div className="flex shrink-0 items-center justify-between gap-4 border-t pt-4">
          <p className="text-xs text-muted-foreground">{saved ? "Issue decisions are saved for the team. Edit Materials to change product information." : "No quantities or selections have been changed."}</p>
          <button type="button" className="shrink-0 bg-ink px-5 py-2.5 text-sm text-white disabled:opacity-50"
            disabled={busy || !!savingIssue} onClick={() => void run()}>{busy ? progress || "Checking plans…" : "Run a new check"}</button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

export function SpecCompletionResults({ projectId, rooms, items = [], findings, issues, onStatusChange, onSaveDetail, onSuggestionSaved, savingIssue = "", checkedAt, itemCount, checking = false, planStatus, document, message, documentRefresh, stale = false }: {
  projectId: string; rooms: CompletionRoom[]; findings: CompletionFinding[]; itemCount: number;
  items?: MaterialItem[];
  documentRefresh?: SpecCompletionReport["document_refresh"];
  issues?: SavedCompletionIssue[]; onStatusChange?: (issue: SavedCompletionIssue, status: CompletionIssueStatus) => Promise<void>;
  savingIssue?: string; checkedAt?: string;
  onSaveDetail?: (issue: SavedCompletionIssue, item: MaterialItem, draft: CompletionDetailDraft) => Promise<void>;
  onSuggestionSaved?: () => void;
  checking?: boolean; planStatus?: SpecCompletionReport["plan_status"]; document: SpecCompletionReport["document"];
  message: string; stale?: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "details" | "plans">("all");
  const [statusFilter, setStatusFilter] = useState<CompletionIssueStatus | "all">("open");
  const qc = useQueryClient();
  const catalogSaved = async () => {
    await Promise.all([["materialItems", projectId], ["spec-completion-review", projectId], ["roomProducts"], ["procurement"]]
      .map(queryKey => qc.invalidateQueries({ queryKey })));
    onSuggestionSaved?.();
  };
  const rows: SavedCompletionIssue[] = issues ?? findings.map(finding => ({ key: finding.id, finding, status: "open", room_name: "",
    document: finding.source === "plans" ? document : null, first_seen_at: checkedAt || "", last_seen_at: checkedAt || "", status_updated_at: null, status_updated_by: null }));
  const counts = completionIssueCounts(rows);
  const visible = rows.filter(issue => (filter === "all" || issue.finding.source === filter) && (statusFilter === "all" || issue.status === statusFilter));
  const reviewRooms = [...rooms];
  for (const issue of rows) if (!reviewRooms.some(room => room.id === issue.finding.room_id))
    reviewRooms.push({ id: issue.finding.room_id, name: issue.room_name || "Former room" });
  return <>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
      {[[itemCount, "Items reviewed"], [counts.open, "Open issues"], [counts.completed, "Completed"], [counts.not_needed, "Change not needed"]].map(([count, label]) =>
        <div key={label} className="border bg-bone/40 px-4 py-3"><div className="font-display text-3xl">{count}</div><div className="text-xs text-muted-foreground mt-1">{label}</div></div>)}
    </div>
    <div className={`shrink-0 border px-4 py-3 text-sm leading-6 ${planStatus === "unavailable" || stale ? "bg-amber-50 border-amber-200" : "bg-bone/30"}`} role="status" aria-live="polite">
      {checking && <Loader2 className="inline mr-2 h-4 w-4 animate-spin" />}{message}
      {documentRefresh && <p className={`mt-1 text-xs ${documentRefresh.status !== "checked" ? "font-medium text-amber-800" : ""}`}>{documentRefresh.message} Checked {new Date(documentRefresh.checked_at).toLocaleString()}.</p>}
      {document && <a className="block text-xs underline underline-offset-4 mt-1" href={`/projects/${projectId}/construction-docs`}>Source: {document.title}</a>}
      {issues && checkedAt && <p className="text-xs mt-1">Saved check: {new Date(checkedAt).toLocaleString()}</p>}
      {stale && <p className="font-medium mt-1">This saved check may no longer reflect the current selections or plans. You can finish these issues or run a new check for current suggestions.</p>}
    </div>
    {issues && <div className="flex shrink-0 flex-wrap gap-2" aria-label="Filter issue status">
      {([["open", `Open (${counts.open})`], ["completed", `Completed (${counts.completed})`], ["not_needed", `Change not needed (${counts.not_needed})`], ["all", "All statuses"]] as const).map(([value, label]) =>
        <button type="button" key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}
          className={`border px-3 py-2 text-xs ${statusFilter === value ? "bg-ink text-white" : "text-muted-foreground"}`}>{label}</button>)}
    </div>}
    <div className="flex shrink-0 flex-wrap gap-2" aria-label="Filter completion findings">
      {([ ["all", "All findings"], ["details", "Missing details"], ["plans", "From construction plans"] ] as const).map(([value, label]) =>
        <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}
          className={`border px-3 py-2 text-xs ${filter === value ? "bg-ink text-white" : "text-muted-foreground"}`}>{label}</button>)}
      {onStatusChange && <SpecCompletionPossibleItems projectId={projectId} rooms={rooms} items={items} issues={rows} checkedAt={checkedAt} document={document} disabled={checking || !!savingIssue} onAdded={catalogSaved} />}
    </div>
    <div className="min-h-0 overflow-y-auto space-y-6 pr-1">
      {!visible.length && <p className="text-sm py-4 text-muted-foreground">{checking ? "Plan review is still running." : filter === "plans" && planStatus !== "checked" ? "Plan quantities and missing items have not been checked." : "No findings in this section. Details that are not specified in the plans still need your review."}</p>}
      {reviewRooms.filter(room => visible.some(issue => issue.finding.room_id === room.id)).map(room => {
        const groups = new Map<string, SavedCompletionIssue[]>();
        visible.filter(issue => issue.finding.room_id === room.id).forEach(issue => {
          const key = issue.finding.item_id || issue.key;
          groups.set(key, [...(groups.get(key) ?? []), issue]);
        });
        return <section key={room.id}>
          <h3 className="font-display text-2xl mb-3">{room.name}</h3>
          <div className="border divide-y">{Array.from(groups.entries()).map(([key, group]) => {
            const item = items.find(item => item.id === key);
            const checkedPreview = group.find(issue => issue.last_seen_at === checkedAt)?.item_preview ?? group[0].item_preview;
            const selectionChanged = !!item && !!checkedPreview && checkedPreview.product_id !== item.product_id;
            const preview = selectionChanged ? undefined : checkedPreview;
            const image = preview?.image_url || item?.image_url || item?.product?.image_url;
            const productName = preview?.name || item?.product?.name;
            const productLink = completionProductLink(preview?.product_url || item?.product_url || item?.product?.product_url);
            const related = rows.filter(issue => issue.finding.item_id ? issue.finding.item_id === key : issue.key === key);
            const detail = (field: "color" | "dimensions") => related.find(issue => issue.finding.field === field && issue.finding.source === "details" && issue.last_seen_at === checkedAt) ??
              group.find(issue => issue.finding.field === field && issue.finding.source === "details");
            const color = detail("color");
            const dimensions = detail("dimensions");
            const catalogIssues = group.filter(issue => issue.status === "open" && issue.last_seen_at === checkedAt &&
              (issue.finding.field === "missing_item" || (item && item.room_id === room.id && !selectionChanged)));
            const catalogIssue = catalogIssues.find(issue => ["missing_item", "product", "link"].includes(issue.finding.field)) ?? catalogIssues[0];
            const catalogLabel = item?.item_label || catalogIssue?.finding.item_label || "";
            const missingTemplate = completionCatalogTemplate(catalogLabel, item?.category);
            const placeholder = !item ? items.find(row => row.room_id === room.id && row.item_label === missingTemplate.label && untouchedCatalogPlaceholder(row)) : null;
            const canSuggest = (issue: SavedCompletionIssue | undefined) => !!issues && !checking &&
              issue?.status === "open" && issue.last_seen_at === checkedAt && (!stale ||
                (issue.finding.field === "color" && item && needsCompletionColor(item) &&
                  item.room_id === issue.finding.room_id && (!issue.item_preview?.product_id || issue.item_preview.product_id === item.product_id)));
            return <div key={key} className="px-4 py-5 sm:px-5">
              <div className="flex items-start gap-4 bg-bone/40 p-3 sm:p-4">
                {image && <CompletionProductImage key={image} src={image} name={group[0].finding.item_label} />}
                <div className="min-w-0 flex-1">
                  <h4 className="text-xl sm:text-2xl font-semibold leading-tight break-words">{group[0].finding.item_label}</h4>
                  {productName && productName !== group[0].finding.item_label && <p className="text-sm text-muted-foreground mt-1 break-words">{productName}</p>}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                    <a className="inline-flex items-center gap-1 text-xs underline underline-offset-4" href={completionMaterialsLink(projectId, room.id, group[0].finding.item_id)} target="_blank" rel="noopener noreferrer">Review in Materials <ArrowUpRight className="h-3 w-3" /></a>
                    {productLink && <a href={productLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-4">Product link <ArrowUpRight className="h-3 w-3" /></a>}
                  </div>
                </div>
              </div>
              {catalogIssue && onStatusChange && rooms.some(current => current.id === room.id) && !item?.not_needed && <div className="mt-3 flex flex-wrap items-center gap-3">
                <MaterialCatalogSuggestions projectId={projectId} roomId={room.id} roomName={room.name} label={catalogLabel}
                  existingItem={item || placeholder || null} completionIssue={catalogIssue} replace={!!item}
                  disabled={checking || !!savingIssue || !!(item?.ordered || item?.received || item?.installed)} onAdded={catalogSaved} />
                <p className="text-xs text-muted-foreground">{item ? "Choose a replacement if the selection needs correction. Quantity is kept." : "Choose a product to fill this missing item."}</p>
              </div>}
              {selectionChanged && <p className="mt-3 text-xs text-amber-900">The selected product has changed since this check. Run the check again to review its current details and fit.</p>}
              {group.map(issue => {
                const row = issue.finding;
                const earlier = !!issues && issue.last_seen_at !== checkedAt;
                return <div key={issue.key} className="mt-3 border-t pt-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-40">
                      <p className="font-medium">{row.dimension_scope === "proposed_layout" ? "Planned dimensions" : fieldLabels[row.field]}{row.source === "plans" ? ` · Plan suggests: ${row.suggested}` : ""}</p>
                      {row.source === "details" && <p className="text-xs text-muted-foreground mt-1">{row.message || "Needs confirmation."}</p>}
                      {row.current && <p className="text-xs text-muted-foreground mt-1">Current at check: {row.current}</p>}
                      {earlier && <p className="text-xs text-amber-800 mt-1">From an earlier check. Review whether this still applies.</p>}
                    </div>
                    {onStatusChange && <div className="flex flex-wrap gap-2 text-xs">
                      {issue.status === "open" ? <>
                        <button disabled={!!savingIssue} className="border px-2 py-1 disabled:opacity-50" onClick={() => void onStatusChange(issue, "completed")}>{savingIssue === issue.key ? "Saving…" : "Completed"}</button>
                        <button disabled={!!savingIssue} className="border px-2 py-1 disabled:opacity-50" onClick={() => void onStatusChange(issue, "not_needed")}>Change not needed</button>
                      </> : <>
                        <span className="border bg-bone/50 px-2 py-1">{issue.status === "completed" ? "Completed" : "Change not needed"}</span>
                        <button disabled={!!savingIssue} className="underline disabled:opacity-50" onClick={() => void onStatusChange(issue, "open")}>Reopen</button>
                      </>}
                    </div>}
                  </div>
                  {onSaveDetail && item && issue.status === "open" && ["color", "finish", "price", "price_unit", "dimensions"].includes(row.field) &&
                    item.room_id === row.room_id && (!issue.item_preview?.product_id || issue.item_preview.product_id === item.product_id) && (
                    <CompletionDetailEditor key={issue.key} item={item} issue={issue} disabled={!!savingIssue}
                      onSave={draft => onSaveDetail(issue, item, draft)} />
                  )}
                  <div className="mt-3 border-l-2 border-ink/30 bg-bone/30 px-3 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide">Suggested next step</p>
                    <p className="mt-1 text-sm leading-6">{completionSolution(row, item, issue.suggestion)}</p>
                  </div>
                  {issue.key === color?.key && (canSuggest(color) || color.suggestion?.kind === "color") && color.finding.item_id && (
                    <BoardColorReview key={color.key} projectId={projectId} itemId={color.finding.item_id}
                      initial={color.suggestion?.kind === "color" ? color.suggestion.value : undefined} allowCheck={canSuggest(color)} onSaved={onSuggestionSaved} />
                  )}
                  {row.source === "plans" && <>
                    <p className="text-xs text-muted-foreground mt-2">{issue.document?.title ? `${issue.document.title} · ` : ""}Page {row.page}{row.sheet ? ` · ${row.sheet}` : ""} — {row.evidence}</p>
                    {row.dimension_scope === "proposed_layout" && <p className="text-xs text-muted-foreground mt-1">Confirm the selected product matches this planned size before saving.</p>}
                  </>}
                </div>;
              })}
              {dimensions && ((canSuggest(dimensions) && !related.some(issue => issue.finding.field === "dimensions" && issue.finding.source === "plans" && issue.last_seen_at === checkedAt)) || dimensions.suggestion?.kind === "dimensions") && dimensions.finding.item_id && (
                <PlanDimensionReview key={dimensions.key} projectId={projectId} itemId={dimensions.finding.item_id}
                  initial={dimensions.suggestion?.kind === "dimensions" ? dimensions.suggestion.value : undefined} allowCheck={canSuggest(dimensions)} onSaved={onSuggestionSaved} />
              )}
            </div>;
          })}</div>
        </section>;
      })}
    </div>
  </>;
}

function CompletionDetailEditor({ item, issue, disabled, onSave }: {
  item: MaterialItem; issue: SavedCompletionIssue; disabled: boolean; onSave: (draft: CompletionDetailDraft) => Promise<void>;
}) {
  const price = issue.finding.field === "price" || issue.finding.field === "price_unit";
  const dimensions = issue.finding.field === "dimensions";
  const initial = price ? item.product?.price : dimensions ? item.product?.dimensions || item.product?.selected_size : item.color;
  const [value, setValue] = useState(hasCompletionValue(initial) ? initial! : "");
  const [priceUnit, setPriceUnit] = useState<CompletionDetailDraft["priceUnit"]>(materialPriceUnit(item) || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const suggestion = dimensions
    ? issue.suggestion?.kind === "dimensions" && issue.suggestion.value.status === "suggested" ? issue.suggestion.value.dimensions
      : issue.finding.source === "plans" && hasCompletionValue(issue.finding.suggested) ? issue.finding.suggested : null
    : issue.suggestion?.kind === "color" && issue.suggestion.value.status === "suggested" ? issue.suggestion.value.color : null;
  if (price && item.product?.markup_percent != null) return <p className="mt-3 text-xs text-muted-foreground">This price uses markup. Use Review in Materials to edit its pricing settings.</p>;
  const save = async () => {
    if (lock.current || disabled) return;
    lock.current = true; setSaving(true); setError("");
    try { await onSave({ value, ...(price ? { priceUnit } : {}) }); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save this detail."); }
    finally { lock.current = false; setSaving(false); }
  };
  return <form className="mt-3 border bg-white p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset disabled={disabled || saving} className="flex flex-wrap items-end gap-3 min-w-0">
      <label className="min-w-40 flex-1">
        <span className="block text-xs font-medium mb-1">{price ? "Price" : dimensions ? "Confirmed product dimensions / size" : "Confirmed color / finish"}</span>
        <input aria-label={`${price ? "Price" : dimensions ? "Dimensions" : "Color / finish"} for ${issue.finding.item_label}`} value={value}
          onChange={event => setValue(event.target.value)} inputMode={price ? "decimal" : undefined}
          placeholder={price ? "0.00" : dimensions ? 'e.g. 30" W × 36" H' : "e.g. Brushed brass"} maxLength={price ? 40 : 200}
          className="h-10 w-full border border-input bg-background px-3 text-sm" />
      </label>
      {price && <label>
        <span className="block text-xs font-medium mb-1">Price is per</span>
        <select aria-label={`Price basis for ${issue.finding.item_label}`} value={priceUnit}
          onChange={event => setPriceUnit(event.target.value as CompletionDetailDraft["priceUnit"])} className="h-10 border border-input bg-background px-3 text-sm">
          <option value="">Choose unit</option><option value="unit">Item / unit</option><option value="sq_ft">Square foot</option>
        </select>
      </label>}
      <button type="submit" className="h-10 bg-ink px-4 text-sm text-white disabled:opacity-50">{saving ? "Saving…" : "Save & complete"}</button>
      {!price && suggestion && <button type="button" className="text-xs underline" onClick={() => setValue(suggestion)}>{dimensions ? "Use suggested dimensions" : "Use suggested color"}</button>}
    </fieldset>
    <p className="mt-2 text-xs text-muted-foreground">Saves to Materials and the Spec Book, then completes this issue.</p>
    {dimensions && <p className="mt-1 text-xs text-muted-foreground">Include units. Confirm the selected product matches the planned size before saving.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-800">{error}</p>}
  </form>;
}

function CompletionProductImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 flex items-center justify-center border bg-white text-muted-foreground" aria-label="Product image unavailable"><ImageOff className="h-5 w-5" /></div> :
    <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 border object-contain bg-white" />;
}

function BoardColorReview({ projectId, itemId, initial, allowCheck = true, onSaved }: { projectId: string; itemId: string; initial?: BoardColorSuggestion; allowCheck?: boolean; onSaved?: () => void }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<BoardColorSuggestion | null>(initial ?? null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const suggest = async () => {
    if (lock.current) return;
    lock.current = true; setChecking(true); setError(""); setResult(null);
    try { setResult(await fetchBoardColorSuggestion(projectId, itemId)); onSaved?.(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not suggest a color."); }
    finally { lock.current = false; setChecking(false); }
  };
  return <div className="mt-3">
    {allowCheck && <button type="button" disabled={checking} onClick={() => void suggest()}
      className="inline-flex items-center gap-2 border px-3 py-2 text-xs disabled:opacity-50">
      {checking && <Loader2 className="h-3 w-3 animate-spin" />}
      {checking ? "Checking Design Board…" : result ? "Check Design Board again" : "Check Design Board"}
    </button>}
    {allowCheck && <p className="mt-1 text-xs text-muted-foreground">Suggest a likely color from this item’s linked board image. Your selection stays unchanged.</p>}
    <div role="status" aria-live="polite">
      {error && <p className="mt-2 text-xs text-muted-foreground">{error}</p>}
      {result && <div className="mt-3 flex gap-3 border bg-bone/30 p-3">
        {result.source && <img src={result.source.image_url} alt="Linked design-board product" loading="lazy" className="h-20 w-20 shrink-0 object-contain bg-white" />}
        <div className="text-xs leading-5">
          {result.status === "suggested" && <p className="font-medium text-sm">Likely color: {result.color}</p>}
          <p>{result.reason}</p>
          {result.status === "suggested" && <p className="text-muted-foreground mt-1">Visual estimate · verify the exact manufacturer color/finish before saving in Materials.</p>}
          {result.source && <a href={`/projects/${projectId}/design-boards`} className="underline underline-offset-4 mt-1 block">View source: {result.source.page_name}</a>}
        </div>
      </div>}
    </div>
  </div>;
}

function PlanDimensionReview({ projectId, itemId, initial, allowCheck = true, onSaved }: { projectId: string; itemId: string; initial?: PlanDimensionSuggestion; allowCheck?: boolean; onSaved?: () => void }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<PlanDimensionSuggestion | null>(initial ?? null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const suggest = async () => {
    if (lock.current) return;
    lock.current = true; setChecking(true); setError(""); setResult(null);
    try { setResult(await fetchPlanDimensionSuggestion(projectId, itemId)); onSaved?.(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not suggest dimensions."); }
    finally { lock.current = false; setChecking(false); }
  };
  return <div className="mt-3">
    {allowCheck && <button type="button" disabled={checking} onClick={() => void suggest()}
      className="inline-flex items-center gap-2 border px-3 py-2 text-xs disabled:opacity-50">
      {checking && <Loader2 className="h-3 w-3 animate-spin" />}
      {checking ? "Looking for dimensions…" : result ? "Check dimensions again" : "Suggest dimensions from construction docs"}
    </button>}
    <div role="status" aria-live="polite">
      {error && <p className="mt-2 text-xs text-muted-foreground">{error}</p>}
      {result && <div className="mt-3 border bg-bone/30 p-3 text-xs leading-5">
        {result.status === "suggested" && <p className="font-medium text-sm">{result.dimension_scope === "proposed_layout" ? "Planned size" : "Specified dimensions"}: {result.dimensions}</p>}
        <p>{result.message}</p>
        {result.evidence && <p className="mt-2 text-muted-foreground">Page {result.page}{result.sheet ? ` · ${result.sheet}` : ""} — {result.evidence}</p>}
        {result.document && <a href={`/projects/${projectId}/construction-docs`} className="underline underline-offset-4 mt-1 block">View source: {result.document.title}</a>}
      </div>}
    </div>
  </div>;
}
