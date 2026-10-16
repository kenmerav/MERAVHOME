import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Search,
  Expand,
  X,
  Plus,
  Minus,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import {
  openConstructionPdf,
  previewConstructionPage,
  constructionPageText,
} from "@/lib/constructionPdfPreview";
import {
  drawingCalloutHighlights,
  type DrawingCalloutHighlight,
} from "@/lib/specDrawingHighlights";
import { createStudioSessionRequest } from "@/lib/studioSessionRequest";
import {
  drawingMatchItems,
  type DrawingMatchItem,
  type DrawingMatchReport,
  type SpecDrawingMatch,
} from "@/lib/specDrawingMatches";
import type { MaterialItem, Room } from "@/lib/db";
import { buildSpecSpreadsheetRows, type SpecSpreadsheetRow } from "@/lib/specBookRows";
import {
  SpecDrawingSelectionDetails,
  type DrawingSpecVisibility,
} from "./SpecDrawingSelectionDetails";

type RequestMatches = (method: "GET" | "POST", key?: string) => Promise<DrawingMatchReport>;
type Pdf = Awaited<ReturnType<typeof openConstructionPdf>>;
function DrawingPage({
  pdf,
  page,
  bounds,
  full = false,
  item,
  items,
  roomVerified,
}: {
  pdf: Promise<Pdf>;
  page: number;
  bounds: SpecDrawingMatch["bounds"];
  full?: boolean;
  item: DrawingMatchItem;
  items: DrawingMatchItem[];
  roomVerified: boolean;
}) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [aspect, setAspect] = useState(1.5);
  const [highlightResult, setHighlightResult] = useState<{
    pdf: Promise<Pdf>;
    page: number;
    item: DrawingMatchItem;
    items: DrawingMatchItem[];
    roomVerified: boolean;
    marks: DrawingCalloutHighlight[];
  } | null>(null);
  const highlights =
    highlightResult?.pdf === pdf &&
    highlightResult.page === page &&
    highlightResult.item === item &&
    highlightResult.items === items &&
    highlightResult.roomVerified === roomVerified
      ? highlightResult.marks
      : [];
  useEffect(() => {
    let cancelled = false;
    setHighlightResult(null);
    void pdf
      .then((source) => constructionPageText(source, page))
      .then((runs) => {
        if (!cancelled)
          setHighlightResult({
            pdf,
            page,
            item,
            items,
            roomVerified,
            marks: drawingCalloutHighlights(runs, item, items, roomVerified),
          });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pdf, page, item, items, roomVerified]);
  useEffect(() => {
    const abort = new AbortController();
    let url = "";
    setImage("");
    setError("");
    void (async () => {
      try {
        const source = await pdf;
        abort.signal.throwIfAborted();
        const canvas = await previewConstructionPage(
          source,
          page,
          abort.signal,
          full ? 3200 : 1500,
        );
        setAspect(canvas.width / canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(Error("Could not display the drawing."))),
            "image/webp",
            0.92,
          ),
        );
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not display this page.");
      }
    })();
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [pdf, page, full]);
  const crop = !full && bounds ? bounds : null;
  const w = crop ? crop.right - crop.left : 1,
    h = crop ? crop.bottom - crop.top : 1;
  if (error) return <div className="p-8 text-sm text-muted-foreground">{error}</div>;
  return (
    <div className="relative overflow-hidden bg-white" style={{ aspectRatio: (aspect * w) / h }}>
      {image ? (
        <img
          alt={`Construction drawing — PDF page ${page}`}
          src={image}
          className="absolute block"
          style={{
            width: `${100 / w}%`,
            maxWidth: "none",
            left: crop ? `${(-100 * crop.left) / w}%` : 0,
            top: crop ? `${(-100 * crop.top) / h}%` : 0,
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading drawing…
        </div>
      )}
      {image &&
        highlights.map((mark, index) => (
          <span
            key={index}
            data-drawing-callout="true"
            role="img"
            aria-label={`Highlighted callout: ${mark.text}`}
            title={mark.text}
            className="pointer-events-none absolute border-[3px] border-amber-600 bg-amber-300/20"
            style={{
              left: `${(100 * (mark.bounds.left - (crop?.left || 0))) / w}%`,
              top: `${(100 * (mark.bounds.top - (crop?.top || 0))) / h}%`,
              width: `${(100 * (mark.bounds.right - mark.bounds.left)) / w}%`,
              height: `${(100 * (mark.bounds.bottom - mark.bounds.top)) / h}%`,
            }}
          />
        ))}
    </div>
  );
}
function kindLabel(match: SpecDrawingMatch) {
  if (match.kind === "room") return "Room drawings";
  return match.kind === "product"
    ? match.basis === "product_name"
      ? "Product name referenced on this sheet"
      : "Product referenced on this sheet"
    : match.kind === "location"
      ? "Room / item callout"
      : match.basis === "room_item"
        ? "Item callout · confirm selection"
        : "Product reference · confirm room";
}
export function SpecConstructionDrawingsView({
  projectId,
  projectName,
  items,
  rooms,
  requestMatches,
  previewItems,
  specRows,
  visibility = {
    showPricing: false,
    showLinks: false,
    showOrdering: false,
    hideInternalProductDetails: true,
  },
  initialQuery = "",
}: {
  projectId: string;
  projectName: string;
  items: MaterialItem[];
  rooms: Pick<Room, "id" | "name">[];
  requestMatches?: RequestMatches;
  previewItems?: DrawingMatchItem[];
  specRows?: SpecSpreadsheetRow[];
  visibility?: DrawingSpecVisibility;
  initialQuery?: string;
}) {
  const [report, setReport] = useState<DrawingMatchReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(initialQuery),
    [category, setCategory] = useState(""),
    [open, setOpen] = useState<string | null>(null),
    [filter, setFilter] = useState("all");
  const [viewer, setViewer] = useState<{
      item: DrawingMatchItem;
      matches: SpecDrawingMatch[];
      index: number;
    } | null>(null),
    [zoom, setZoom] = useState(100),
    [full, setFull] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const selectionRows = useMemo(
    () => new Map((specRows || buildSpecSpreadsheetRows(items, rooms)).map((row) => [row.id, row])),
    [specRows, items, rooms],
  );
  const selected = useMemo(() => {
    const matchingItems = previewItems || drawingMatchItems(items, rooms);
    const byId = new Map(matchingItems.map((item) => [item.id, item]));
    // Keep every original spec row, including selections without a readable SKU
    // or an assigned room. Missing drawing matches must never hide the item.
    return selectionRows.size
      ? [...selectionRows.values()].map(
          (row, index) =>
            byId.get(row.id) || {
              id: row.id,
              ref: `S${index + 1}`,
              roomId: row.roomId,
              room: row.room,
              label: row.itemLabel,
              name: row.productName,
              sku: row.sku,
              vendor: row.vendor,
              finish: row.finish,
              dimensions: row.dimensions,
              cad: row.cadLabel,
              image: row.imageUrl,
            },
        )
      : matchingItems;
  }, [items, rooms, previewItems, selectionRows]);
  const request = useMemo<RequestMatches>(
    () =>
      requestMatches ||
      (async (method, key) => {
        const send = await createStudioSessionRequest();
        const response = await send(
          `/api/spec-drawing-matches?projectId=${encodeURIComponent(projectId)}`,
          {
            method,
            ...(method === "POST"
              ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ projectId, expectedKey: key }),
                }
              : {}),
          },
        );
        const value = await response.json().catch(() => null);
        if (!response.ok)
          throw Error(value?.error || "Could not load construction drawing matches.");
        return value;
      }),
    [projectId, requestMatches],
  );
  const checking = report?.status === "checking" || report?.status === "queued";
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await request("GET");
        if (!live) return;
        setReport(value);
        setError("");
        clearTimeout(timer);
        timer = setTimeout(load, ["checking", "queued"].includes(value.status) ? 10000 : 60000);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load drawing matches.");
      }
    }
    void load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("focus", load);
    };
  }, [request, checking]);
  // Signed URLs rotate on reads; source identity, rather than URL text, owns
  // this single PDF download. Never reload a large PDF on every progress poll.
  const pdfCache = useRef<{ key: string; promise: Promise<Pdf> } | null>(null);
  const [pdf, setPdf] = useState<Promise<Pdf> | null>(null);
  useEffect(() => {
    if (!open || !report?.documentUrl) return;
    if (pdfCache.current?.key === report.key) {
      setPdf(pdfCache.current.promise);
      return;
    }
    if (pdfCache.current)
      void pdfCache.current.promise.then((p) => p.destroy()).catch(() => undefined);
    const promise = openConstructionPdf(report.documentUrl);
    void promise.catch(() => undefined);
    pdfCache.current = { key: report.key, promise };
    setPdf(promise);
  }, [open, report?.key, report?.documentUrl]);
  useEffect(() => {
    setOpen(null);
    setViewer(null);
    dialog.current?.close();
    if (pdfCache.current && pdfCache.current.key !== report?.key) {
      void pdfCache.current.promise.then((p) => p.destroy()).catch(() => undefined);
      pdfCache.current = null;
      setPdf(null);
    }
  }, [report?.key]);
  useEffect(
    () => () => {
      if (pdfCache.current)
        void pdfCache.current.promise.then((p) => p.destroy()).catch(() => undefined);
    },
    [],
  );
  // The PDF is downloaded once; only expanded item pages are rendered.
  const byItem = useMemo(() => {
    const map = new Map<string, SpecDrawingMatch[]>();
    for (const match of report?.matches || [])
      map.set(match.itemId, [...(map.get(match.itemId) || []), match]);
    return map;
  }, [report?.matches]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of selected) {
      const name = selectionRows.get(item.id)?.category || "Other";
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [selected, selectionRows]);
  const filtered = selected.filter(
    (item) =>
      (!category || (selectionRows.get(item.id)?.category || "Other") === category) &&
      [item.room, item.label, item.name, item.sku]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "review" && (byItem.get(item.id) || []).some((m) => m.kind === "review")) ||
        (filter === "unlocated" && !byItem.has(item.id))),
  );
  const groups = Array.from(new Set(filtered.map((item) => item.roomId))).map((id) => ({
    id,
    name: filtered.find((item) => item.roomId === id)!.room,
    items: filtered.filter((item) => item.roomId === id),
  }));
  function show(item: DrawingMatchItem, matches: SpecDrawingMatch[], index: number) {
    setViewer({ item, matches, index });
    setZoom(100);
    setFull(true);
    dialog.current?.showModal();
  }
  async function scan() {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      setReport(await request("POST", report.key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the scan.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="spec-drawing-view border border-border bg-white p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-6">
        <div>
          <div className="eyebrow mb-2">Construction Drawings View</div>
          <h1 className="font-display text-4xl">{projectName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete item specifications, with the related construction sheets underneath.
          </p>
        </div>
        {report?.canScan && report.status === "unread" && (
          <button
            className="inline-flex items-center gap-2 bg-ink px-5 py-3 text-sm text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void scan()}
          >
            <FileText size={16} />
            {busy ? "Starting…" : "Match construction drawings"}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="my-5 border border-amber-200 bg-amber-50 p-4 text-sm">
          {error}
          <button
            className="ml-4 underline"
            onClick={() => {
              void request("GET")
                .then((value) => {
                  setReport(value);
                  setError("");
                })
                .catch((e) => setError(e.message));
            }}
          >
            Reload saved matches
          </button>
        </div>
      )}
      {report && (
        <div className="my-5 border border-border bg-bone/30 p-4 text-sm">
          <div className="flex items-center gap-2">
            {checking && <Loader2 size={15} className="animate-spin" />}
            <strong className="font-medium">
              {report.status === "complete"
                ? `Direct PDF matching complete · ${report.indexedPages || report.totalPages} pages indexed · ${report.matches.length} links saved`
                : checking
                  ? report.indexedPages
                    ? `Reading room headings from the drawing sheets… ${report.roomLabelPagesRead || 0} checked`
                    : "Matching product names and item callouts in the construction PDF…"
                  : report.status === "unread"
                    ? "Ready to match the current construction drawings"
                    : report.status === "no_document"
                      ? "No current construction PDF is attached"
                      : `Scan paused · ${report.matches.length} links saved · ${report.indexedPages || report.reviewedPages.length} PDF pages indexed`}
            </strong>
          </div>
          {report.document && (
            <p className="mt-1 text-xs text-muted-foreground">{report.document.title}</p>
          )}
          {report.error && <p className="mt-2 text-xs text-amber-800">{report.error}</p>}
          {checking && (
            <p className="mt-2 text-xs text-muted-foreground">
              Results save in the background. You can leave this page and return later.
            </p>
          )}
          {report.status === "unread" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Find product names, SKUs and room-specific item callouts. Saved matches reopen without
              another scan.
            </p>
          )}
          {report.status === "complete" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Expand an item to see its referenced sheets. If its name or SKU is not identified, all
              available drawings for its room appear instead.
            </p>
          )}
        </div>
      )}
      <div className="my-6 flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-[240px] items-center gap-2 border border-border px-3 py-2 text-muted-foreground">
          <Search size={16} />
          <input
            className="bg-transparent text-sm outline-none"
            aria-label="Search construction drawing items"
            placeholder="Find an item, room or SKU"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-3 text-xs text-muted-foreground">
          Category
          <select
            aria-label="Filter construction items by category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="max-w-[260px] border border-border bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">All categories ({selected.length})</option>
            {categories.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All items"],
            ["review", "Confirm match"],
            ["unlocated", "Not located"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`border border-border px-3 py-2 text-xs ${filter === value ? "bg-ink text-white" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p role="status" aria-live="polite" className="mb-4 text-xs text-muted-foreground">
        {filtered.length} of {selected.length} selections{category ? ` · ${category}` : ""}
      </p>
      {report?.status === "complete" && (
        <p className="mb-6 text-xs text-muted-foreground">
          “Room drawings” shows room context when the item’s name or SKU was not identified. “Not
          located” means neither an item reference nor matching room drawings were found.
        </p>
      )}
      {!groups.length && (
        <p className="py-8 text-sm text-muted-foreground">No selections match this filter.</p>
      )}
      {groups.map((group) => (
        <section key={group.id} id={`construction-room-${group.id}`} className="mb-9 scroll-mt-28">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="font-display text-3xl">{group.name}</h2>
            <span className="text-xs text-muted-foreground">
              {group.items.length} {group.items.length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="divide-y divide-border border border-border">
            {group.items.map((item) => {
              const matches = byItem.get(item.id) || [];
              const roomFallback =
                matches.length > 0 && matches.every((match) => match.kind === "room");
              const expanded = open === item.id;
              const row = selectionRows.get(item.id);
              const displayName = row?.clientProductName || item.label;
              return (
                <article key={item.id}>
                  <button
                    className="flex w-full flex-wrap items-center gap-4 p-4 text-left lg:p-5"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} construction drawings for ${displayName}`}
                    onClick={() => setOpen(expanded ? null : item.id)}
                  >
                    {item.image ? (
                      <img
                        className="h-16 w-16 shrink-0 border border-border object-contain"
                        src={item.image}
                        loading="lazy"
                        alt={displayName}
                      />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center bg-bone">
                        <FileText size={20} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                        {item.label}
                      </span>
                      <span className="mt-1 block font-display text-2xl">{displayName}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.vendor}
                        {!visibility.hideInternalProductDetails && item.sku ? ` · ${item.sku}` : ""}
                      </span>
                    </span>
                    {row?.quantity && (
                      <span className="shrink-0 border-l border-border pl-4 text-right">
                        <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                          Qty
                        </span>
                        <span className="mt-1 block font-display text-2xl">
                          {row.quantity}
                          {row.quantityUnit === "square_feet" ? " Sq Ft" : ""}
                        </span>
                      </span>
                    )}
                    <span className="flex items-center gap-3 text-xs">
                      <span>
                        {matches.length
                          ? `${expanded ? "Hide" : "View"} ${roomFallback ? "room drawings" : "drawings"} · ${matches.length} ${matches.length === 1 ? "page" : "pages"}`
                          : report?.status === "complete"
                            ? "Not located"
                            : "Awaiting scan"}
                      </span>
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </button>
                  {row && <SpecDrawingSelectionDetails row={row} visibility={visibility} />}
                  {expanded && (
                    <div className="border-t border-border bg-bone/20 p-4 lg:p-5">
                      {roomFallback && (
                        <p className="mb-4 text-sm text-muted-foreground">
                          Showing all available drawings for {item.room}. This item was not
                          identified by name or SKU.
                        </p>
                      )}
                      {!matches.length ? (
                        <p className="py-4 text-sm text-muted-foreground">
                          {report?.status === "complete"
                            ? "No item reference or matching room drawings were found. Its full specification remains above."
                            : "Drawing matches for this item have not been saved yet."}
                        </p>
                      ) : (
                        <div className="grid gap-5 xl:grid-cols-2">
                          {matches.map((match, index) => (
                            <section
                              className="border border-border bg-white"
                              key={`${item.id}-${match.page}`}
                            >
                              <div className="flex justify-between gap-3 border-b border-border p-4">
                                <div>
                                  <div className="mb-1 text-sm font-medium">
                                    {match.room || "Room label not confirmed"}
                                  </div>
                                  <div className="text-xs font-medium">
                                    {match.sheet ? `Sheet ${match.sheet}` : "Construction drawing"}{" "}
                                    <span className="font-normal text-muted-foreground">
                                      · PDF page {match.page}
                                    </span>
                                  </div>
                                  <h3 className="mt-1 font-display text-xl">{match.title}</h3>
                                  {match.views.length > 0 && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {match.views.join(" · ")}
                                    </p>
                                  )}
                                </div>
                                <button
                                  aria-label={`Open PDF page ${match.page}`}
                                  onClick={() => show(item, matches, index)}
                                >
                                  <Expand size={16} />
                                </button>
                              </div>
                              {pdf && (
                                <button
                                  className="block w-full p-3"
                                  onClick={() => show(item, matches, index)}
                                  aria-label={`View drawing PDF page ${match.page}`}
                                >
                                  <DrawingPage
                                    pdf={pdf}
                                    page={match.page}
                                    bounds={match.bounds}
                                    item={item}
                                    items={selected}
                                    roomVerified={
                                      match.kind !== "review" && match.room === item.room
                                    }
                                  />
                                </button>
                              )}
                              <div className="border-t border-border p-4">
                                <div className="mb-2 flex justify-between gap-3">
                                  <span
                                    className={`text-[11px] ${match.kind === "review" ? "text-amber-800" : "text-muted-foreground"}`}
                                  >
                                    {kindLabel(match)}
                                  </span>
                                  <button
                                    className="inline-flex items-center gap-1 text-xs"
                                    onClick={() => show(item, matches, index)}
                                  >
                                    Open full sheet <ArrowUpRight size={13} />
                                  </button>
                                </div>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  {match.evidence}
                                </p>
                                {match.roomEvidence && (
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    Room heading: {match.roomEvidence}
                                  </p>
                                )}
                                {match.kind === "review" && (
                                  <p className="mt-2 text-xs leading-relaxed text-amber-800">
                                    {match.basis === "room_item"
                                      ? "This room has more than one possible selection for this callout. Confirm which item it refers to."
                                      : "A product name or identifier is on this page. Check the visible room label to confirm placement."}
                                  </p>
                                )}
                              </div>
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {report && report.uncertainties.length > 0 && (
        <details className="my-5 border border-border p-4 text-sm">
          <summary className="cursor-pointer">
            {report.uncertainties.length} drawing uncertainties
          </summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-muted-foreground">
            {report.uncertainties.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </details>
      )}
      <dialog
        ref={dialog}
        className="fixed inset-0 m-auto h-[94vh] max-h-[94vh] w-[96vw] max-w-[1600px] border border-border bg-white p-0 backdrop:bg-black/70"
        aria-label="Construction sheet viewer"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        {viewer && (
          <div className="flex h-full flex-col">
            <header className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <div className="eyebrow">
                  {viewer.item.room} · {viewer.item.label}
                </div>
                <h2 className="mt-2 font-display text-3xl">
                  {viewer.matches[viewer.index].sheet
                    ? `Sheet ${viewer.matches[viewer.index].sheet}`
                    : "Drawing"}{" "}
                  <span className="text-muted-foreground">
                    · PDF page {viewer.matches[viewer.index].page}
                  </span>
                </h2>
              </div>
              <button aria-label="Close construction sheet" onClick={() => dialog.current?.close()}>
                <X size={22} />
              </button>
            </header>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
              <div className="flex flex-wrap gap-2">
                {viewer.matches.map((match, index) => (
                  <button
                    key={match.page}
                    onClick={() => {
                      setViewer({ ...viewer, index });
                      setZoom(100);
                    }}
                    className={`border border-border px-3 py-2 text-xs ${viewer.index === index ? "bg-ink text-white" : ""}`}
                  >
                    {match.sheet ? `Sheet ${match.sheet}` : `Page ${match.page}`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button
                  onClick={() => {
                    setFull((v) => !v);
                    setZoom(100);
                  }}
                >
                  {full ? "Drawing detail" : "Full sheet"}
                </button>
                <button
                  aria-label="Zoom out"
                  disabled={zoom <= 75}
                  onClick={() => setZoom((v) => Math.max(75, v - 25))}
                >
                  <Minus size={16} />
                </button>
                <span>{zoom}%</span>
                <button
                  aria-label="Zoom in"
                  disabled={zoom >= 200}
                  onClick={() => setZoom((v) => Math.min(200, v + 25))}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-bone p-5">
              <div className="mx-auto bg-white shadow-sm" style={{ width: `${zoom}%` }}>
                {pdf && (
                  <DrawingPage
                    pdf={pdf}
                    page={viewer.matches[viewer.index].page}
                    bounds={viewer.matches[viewer.index].bounds}
                    full={full}
                    item={viewer.item}
                    items={selected}
                    roomVerified={
                      viewer.matches[viewer.index].kind !== "review" &&
                      viewer.matches[viewer.index].room === viewer.item.room
                    }
                  />
                )}
              </div>
            </div>
            <p className="border-t border-border p-4 text-xs text-muted-foreground">
              {viewer.matches[viewer.index].evidence}
            </p>
          </div>
        )}
      </dialog>
    </section>
  );
}
