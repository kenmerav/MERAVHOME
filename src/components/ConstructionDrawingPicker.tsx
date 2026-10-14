import { useEffect, useMemo, useRef, useState } from "react";
import { createClientOnlyFn } from "@tanstack/react-start";
import { studioHeaders } from "@/lib/measuredRequest";
import {
  drawingBoundsSchema,
  constructionPageEntries,
  filterConstructionPages,
  constructionPreviewKey,
  type ConstructionDrawingView,
  type DrawingBounds,
  type DrawingCitation,
} from "@/lib/constructionDrawingViews";
import {
  openConstructionPdf,
  previewConstructionPage,
  cropConstructionPage,
} from "@/lib/constructionPdfPreview";
import { printedAreaPageName, type PrintedPageAreas } from "@/lib/constructionPageAreas";

type DrawingData = {
  documents: { id: string; title: string; updatedAt: string }[];
  document?: { id: string; title: string; key: string; url: string };
  views?: ConstructionDrawingView[];
  allViews?: ConstructionDrawingView[];
  rooms?: { id: string; name: string }[];
  status?: string;
  error?: string;
  pages?: number;
  pageAreas?: PrintedPageAreas | null;
};
const fullPage: DrawingBounds = { left: 0, top: 0, right: 1, bottom: 1 };
const readPrintedAreas = createClientOnlyFn(
  async (
    pdf: Awaited<ReturnType<typeof openConstructionPdf>>,
    progress: (done: number, total: number) => void,
    signal: AbortSignal,
  ) => {
    const { readConstructionPageAreas } = await import("@/lib/constructionPageAreas.client");
    return readConstructionPageAreas(pdf, progress, signal);
  },
);
export function ConstructionDrawingPicker({
  projectId,
  roomId,
  disabled: suppliedDisabled,
  onChoose,
}: {
  projectId: string;
  roomId: string;
  disabled: boolean;
  onChoose: (blob: Blob, citation: DrawingCitation, kind: "source" | "support") => Promise<void>;
}) {
  const [data, setData] = useState<DrawingData>({ documents: [] }),
    [documentId, setDocumentId] = useState("");
  const [viewId, setViewId] = useState(""),
    [page, setPage] = useState(1),
    [bounds, setBounds] = useState(fullPage);
  const [pdfState, setPdfState] = useState<{
    key: string;
    pdf: Awaited<ReturnType<typeof openConstructionPdf>>;
  } | null>(null);
  const [rendered, setRendered] = useState<{
      key: string;
      page: number;
      canvas: HTMLCanvasElement;
    } | null>(null),
    [previewState, setPreviewState] = useState<{ key: string; url: string } | null>(null),
    [pageSearch, setPageSearch] = useState(""),
    [viewScope, setViewScope] = useState<"room" | "document">("room");
  const [error, setError] = useState(""),
    [pdfLoading, setPdfLoading] = useState(false),
    [pageLoading, setPageLoading] = useState(false),
    [documentsLoading, setDocumentsLoading] = useState(true),
    [choosing, setChoosing] = useState(false),
    [starting, setStarting] = useState(false);
  const [localAreas, setLocalAreas] = useState<{ key: string; value: PrintedPageAreas } | null>(
    null,
  );
  const [areaProgress, setAreaProgress] = useState<{ done: number; total: number } | null>(null);
  const [areaError, setAreaError] = useState("");
  const [areaRetry, setAreaRetry] = useState(0);
  const epoch = useRef(0);
  const choosingRef = useRef(false);
  const selectionRef = useRef("");
  const disabled = suppliedDisabled || choosing;
  async function request(action?: Record<string, unknown>, doc = documentId) {
    const url = `/api/measured-rendering?projectId=${projectId}&roomId=${roomId}&drawings=1${doc ? `&documentId=${doc}` : ""}`;
    const response = await fetch(url, {
      headers: await studioHeaders(),
      method: action ? "POST" : "GET",
      signal: AbortSignal.timeout(action ? 60000 : 30000),
      ...(action ? { body: JSON.stringify(action) } : {}),
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || "Could not read project drawings.");
    return body;
  }
  useEffect(() => {
    const version = ++epoch.current;
    let active = true;
    setData((old) =>
      old.document?.id === documentId ? { ...old, views: [] } : { documents: old.documents },
    );
    setError("");
    setViewId("");
    setBounds(fullPage);
    setPage(1);
    setPageSearch("");
    setDocumentsLoading(true);
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await request();
        if (!active || version !== epoch.current) return;
        setData(result);
        if (!documentId && result.documents?.length) setDocumentId(result.documents[0].id);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not read drawings.");
      } finally {
        pending = false;
        if (active && version === epoch.current) setDocumentsLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, roomId, documentId]);
  const documentKey = data.document?.id === documentId ? data.document.key : undefined;
  const pdf = documentKey && pdfState?.key === documentKey ? pdfState.pdf : null;
  const canvas =
    documentKey && rendered?.key === documentKey && rendered.page === page ? rendered.canvas : null;
  const previewKey = constructionPreviewKey(documentKey, page, bounds);
  selectionRef.current = previewKey;
  const preview = canvas && previewState?.key === previewKey ? previewState.url : "";
  const loading = pdfLoading || pageLoading;
  const allViews = useMemo(() => data.allViews || data.views || [], [data.allViews, data.views]);
  const pageCount = pdf?.numPages || data.pages || 0;
  const pageAreas = documentKey
    ? data.pageAreas || (localAreas?.key === documentKey ? localAreas.value : undefined)
    : undefined;
  const pages = useMemo(
    () => constructionPageEntries(pageCount, allViews, data.rooms, pageAreas?.labels),
    [pageCount, allViews, data.rooms, pageAreas],
  );
  const visiblePages = useMemo(
    () => filterConstructionPages(pages, pageSearch),
    [pages, pageSearch],
  );
  const availableViews = viewScope === "room" ? data.views || [] : allViews;
  const selected = allViews.find((v) => v.id === viewId);
  const currentPage = pages.find((p) => p.page === page);
  const targetRoom = data.rooms?.find((r) => r.id === roomId)?.name || "the selected room";
  function selectPage(number: number) {
    if (!Number.isInteger(number) || number < 1 || number > pageCount) return;
    setError("");
    setViewId("");
    setBounds(fullPage);
    setPage(number);
  }
  function selectView(id: string) {
    const view = allViews.find((v) => v.id === id);
    setError("");
    setViewId(id);
    if (view) {
      setPage(view.page);
      setBounds(view.bounds);
    } else setBounds(fullPage);
  }
  useEffect(() => {
    let active = true;
    let loaded: Awaited<ReturnType<typeof openConstructionPdf>> | null = null;
    setPdfState(null);
    setRendered(null);
    setPreviewState(null);
    setPdfLoading(false);
    if (data.document && documentKey) {
      setPdfLoading(true);
      openConstructionPdf(data.document.url)
        .then((result) => {
          loaded = result;
          if (active) {
            setPdfState({ key: documentKey, pdf: result });
            setPage((old) => Math.min(Math.max(1, old), result.numPages));
          } else void result.destroy();
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setPdfLoading(false);
        });
    }
    return () => {
      active = false;
      if (loaded) void loaded.destroy();
    };
  }, [documentKey]);
  useEffect(() => {
    if (!pdf || !documentKey || !data.document || data.pageAreas) {
      setAreaProgress(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const doc = data.document;
    setAreaError("");
    setAreaProgress({ done: 0, total: pdf.numPages });
    void (async () => {
      try {
        if (!active) return;
        const labels =
          localAreas?.key === documentKey
            ? localAreas.value
            : await readPrintedAreas(
                pdf,
                (done, total) => {
                  if (active) setAreaProgress({ done, total });
                },
                controller.signal,
              );
        if (!active) return;
        setLocalAreas({ key: documentKey, value: labels });
        const result = await request(
          {
            action: "save-page-areas",
            documentId: doc.id,
            sourceKey: documentKey,
            pageAreas: labels,
          },
          doc.id,
        );
        if (active) setLocalAreas({ key: documentKey, value: result.pageAreas });
      } catch (e) {
        if (active)
          setAreaError(
            "Could not read or save the printed area names. All pages are still available.",
          );
      } finally {
        if (active) setAreaProgress(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [pdf, documentKey, data.pageAreas, areaRetry]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRendered(null);
    setPreviewState(null);
    setPageLoading(false);
    if (pdf && documentKey) {
      setPageLoading(true);
      previewConstructionPage(pdf, page, controller.signal)
        .then((result) => {
          if (active) setRendered({ key: documentKey, page, canvas: result });
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setPageLoading(false);
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [pdf, page, documentKey]);
  useEffect(() => {
    let active = true,
      url = "";
    if (canvas && drawingBoundsSchema.safeParse(bounds).success) {
      cropConstructionPage(canvas, bounds)
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (active) setPreviewState({ key: previewKey, url });
          else URL.revokeObjectURL(url);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [canvas, bounds, previewKey]);
  async function scan() {
    if (starting) return;
    const version = epoch.current;
    setStarting(true);
    setError("");
    try {
      await request({ action: "index-drawings", documentId });
      const result = await request();
      if (version === epoch.current) setData(result);
    } catch (e) {
      if (version === epoch.current)
        setError(e instanceof Error ? e.message : "Could not scan drawing views.");
    } finally {
      setStarting(false);
    }
  }
  async function choose(kind: "source" | "support") {
    if (
      choosingRef.current ||
      disabled ||
      !canvas ||
      !preview ||
      !data.document ||
      data.document.id !== documentId ||
      loading
    )
      return;
    const version = epoch.current;
    choosingRef.current = true;
    setChoosing(true);
    setError("");
    try {
      const blob = await cropConstructionPage(canvas, bounds);
      if (version !== epoch.current || selectionRef.current !== previewKey) return;
      await onChoose(
        blob,
        {
          documentId: data.document.id,
          documentTitle: data.document.title,
          sourceKey: data.document.key,
          viewId: viewId || `manual-page-${page}`,
          title: selected?.title || printedAreaPageName(page, currentPage?.area),
          sheet:
            selected?.sheet ||
            (currentPage?.sheets.length === 1 ? currentPage.sheets[0] : `PDF page ${page}`),
          page,
          bounds,
        },
        kind,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use this view.");
    } finally {
      choosingRef.current = false;
      setChoosing(false);
    }
  }
  const indexing = starting || ["queued", "processing"].includes(data.status || "");
  return (
    <section className="border bg-bone/30 p-5 mb-6">
      <div className="flex flex-wrap justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-2xl">Choose a construction view</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Pick one room elevation to work on. Other views can support its dimensions.
          </p>
        </div>
        <a className="text-sm underline" href={`/projects/${projectId}/construction-docs`}>
          Project construction docs
        </a>
      </div>
      {documentsLoading && !data.documents.length ? (
        <p role="status" className="text-sm">
          Loading project construction documents…
        </p>
      ) : !data.documents.length ? (
        <p className="text-sm">
          No construction PDF is available yet. Add one in Construction Docs, or upload an elevation
          below.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              Construction document
              <select
                aria-label="Construction document"
                value={documentId}
                disabled={disabled || starting}
                onChange={(e) => setDocumentId(e.target.value)}
                className="block border p-2 mt-1 max-w-96"
              >
                {data.documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} · {new Date(d.updatedAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="bg-ink text-white px-4 py-3 text-sm disabled:opacity-40"
              disabled={
                disabled ||
                indexing ||
                !documentId ||
                data.status === "complete" ||
                data.status === "failed"
              }
              onClick={() => void scan()}
            >
              {indexing
                ? "Finding room views…"
                : data.status === "complete"
                  ? "Room views saved"
                  : "Find room views in this document"}
            </button>
            {data.document && (
              <a
                href={data.document.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline"
              >
                Open original PDF
              </a>
            )}
          </div>
          {indexing && (
            <p role="status" className="text-sm mt-3">
              Reading this document once for all project rooms. You can return later; the view list
              is shared.
            </p>
          )}
          {data.error && <p className="text-sm text-red-700 mt-3">{data.error}</p>}
          <div className="grid md:grid-cols-[minmax(220px,1fr)_2fr] gap-5 mt-5">
            <div>
              <div className="border bg-white p-3 mb-4">
                <h3 className="font-display text-xl">
                  All PDF pages {pageCount ? `(${pageCount})` : ""}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Every page is available, including pages without a room match. Browsing does not
                  use AI credits.
                </p>
                {areaProgress && (
                  <p role="status" className="text-xs mt-2">
                    Reading printed area names… {areaProgress.done} of {areaProgress.total} pages.
                    No AI credits used.
                  </p>
                )}
                {areaError && (
                  <p className="text-xs mt-2">
                    {areaError}{" "}
                    <button
                      className="underline"
                      type="button"
                      onClick={() => setAreaRetry((old) => old + 1)}
                    >
                      Retry area labels
                    </button>
                  </p>
                )}
                {pageCount ? (
                  <>
                    <label className="block text-xs mt-3" htmlFor="construction-page-search">
                      Find a page, sheet or room
                    </label>
                    <input
                      id="construction-page-search"
                      className="border p-2 mt-1 w-full text-sm"
                      value={pageSearch}
                      onChange={(e) => setPageSearch(e.target.value)}
                      placeholder="Page number, ID2.8, bathroom…"
                      disabled={disabled}
                    />
                    <div
                      role="group"
                      aria-label="All construction PDF pages"
                      className="max-h-64 overflow-y-auto mt-3 space-y-1"
                    >
                      {visiblePages.map((p) => (
                        <button
                          key={p.page}
                          type="button"
                          aria-label={p.label}
                          aria-pressed={p.page === page}
                          title={p.label}
                          disabled={disabled || !pdf}
                          onClick={() => selectPage(p.page)}
                          className={`w-full text-left border px-3 py-2 text-sm disabled:opacity-40 ${p.page === page ? "border-ink bg-bone" : "border-transparent hover:bg-bone/60"}`}
                        >
                          <span>{p.area || `Page ${p.page}`}</span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {p.area ? `Page ${p.page} · ` : ""}
                            {p.sheets.join(" · ") || "Full page available"}
                            {pageAreas && !p.area ? " · Area name not found" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                    {!visiblePages.length && (
                      <p className="text-xs mt-3">
                        No pages match that search.{" "}
                        <button className="underline" onClick={() => setPageSearch("")}>
                          Show all pages
                        </button>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {visiblePages.length} of {pageCount} pages shown.
                    </p>
                    <div className="flex items-end gap-2 mt-3">
                      <button
                        type="button"
                        className="border p-2 text-xs disabled:opacity-40"
                        aria-label="Previous construction PDF page"
                        disabled={disabled || !pdf || page <= 1}
                        onClick={() => selectPage(page - 1)}
                      >
                        Previous
                      </button>
                      <label className="text-xs flex-1">
                        PDF page
                        <select
                          aria-label="Construction PDF page"
                          value={page}
                          disabled={disabled || !pdf}
                          onChange={(e) => selectPage(Number(e.target.value))}
                          className="block border p-2 mt-1 w-full"
                        >
                          {pages.map((p) => (
                            <option key={p.page} value={p.page}>
                              {printedAreaPageName(p.page, p.area)}
                              {p.sheets.length ? ` · ${p.sheets.join(" / ")}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="border p-2 text-xs disabled:opacity-40"
                        aria-label="Next construction PDF page"
                        disabled={disabled || !pdf || page >= pageCount}
                        onClick={() => selectPage(page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </>
                ) : (
                  <p role="status" className="text-sm mt-3">
                    {pdfLoading
                      ? "Opening PDF and loading its page list…"
                      : "The page list will appear when this PDF opens."}
                  </p>
                )}
              </div>
              <label className="text-xs block mb-2">
                Drawing shortcuts
                <select
                  aria-label="Construction view list"
                  value={viewScope}
                  onChange={(e) => setViewScope(e.target.value as "room" | "document")}
                  className="block border p-2 mt-1 w-full"
                  disabled={disabled}
                >
                  <option value="room">Suggested room views ({data.views?.length || 0})</option>
                  <option value="document">All indexed drawing views ({allViews.length})</option>
                </select>
              </label>
              <label className="text-sm">
                {viewScope === "room" ? "Views matching this room" : "Views in this document"}
                <select
                  aria-label="Construction view"
                  className="block border p-2 mt-1 w-full"
                  disabled={disabled || !availableViews.length || !pdf}
                  value={availableViews.some((v) => v.id === viewId) ? viewId : ""}
                  onChange={(e) => selectView(e.target.value)}
                >
                  <option value="">Choose a view</option>
                  {availableViews.map((v, index) => (
                    <option key={v.id} value={v.id}>
                      {v.sheet} · {v.title}
                      {availableViews.filter(
                        (other) =>
                          other.sheet === v.sheet &&
                          other.title === v.title &&
                          other.page === v.page,
                      ).length > 1
                        ? ` · View ${index + 1}`
                        : ""}{" "}
                      · PDF {v.page}
                      {viewScope === "document"
                        ? ` · ${data.rooms?.find((r) => r.id === v.roomId)?.name || "Room unconfirmed"}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              {data.status === "complete" && !data.views?.length && (
                <p className="text-xs mt-2">
                  No confident room match was found. Browse a page and choose its drawing area.
                </p>
              )}
              {selected && (
                <p className="text-xs mt-2 text-muted-foreground">
                  {selected.kind} · {selected.evidence}
                </p>
              )}
              {currentPage?.views.length ? (
                <label className="text-xs block mt-4">
                  Drawings on page {page}
                  <select
                    aria-label="Drawing on selected PDF page"
                    className="block border p-2 mt-1 w-full"
                    value={viewId}
                    onChange={(e) => selectView(e.target.value)}
                    disabled={disabled || !pdf}
                  >
                    <option value="">Use the whole page / choose a crop</option>
                    {currentPage.views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sheet} · {v.title} ·{" "}
                        {data.rooms?.find((r) => r.id === v.roomId)?.name || "Room unconfirmed"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selected?.roomId && selected.roomId !== roomId && (
                <p className="text-xs mt-2">
                  This drawing is labelled{" "}
                  {data.rooms?.find((r) => r.id === selected.roomId)?.name || "another room"}. You
                  are working in {targetRoom}.
                </p>
              )}
              <details className="mt-4">
                <summary className="text-sm cursor-pointer">Adjust drawing crop</summary>
                <button
                  type="button"
                  className="underline text-xs mt-3"
                  disabled={disabled || !pdf}
                  onClick={() => selectPage(page)}
                >
                  Reset to whole page
                </button>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {(["left", "top", "right", "bottom"] as const).map((axis) => (
                    <label key={axis} className="text-xs capitalize">
                      {axis} (%)
                      <input
                        aria-label={`Drawing crop ${axis}`}
                        className="border p-2 block w-full"
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        disabled={disabled}
                        value={Math.round(bounds[axis] * 1000) / 10}
                        onChange={(e) =>
                          setBounds({ ...bounds, [axis]: Number(e.target.value) / 100 })
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Keep the view title and dimensions inside the crop. Room matches and crop edges
                  need review.
                </p>
              </details>
            </div>
            <div>
              <p className="text-sm mb-3">
                {currentPage?.area ? `${currentPage.area} · ` : ""}PDF page {page}
                {pageCount ? ` of ${pageCount}` : ""}
                {currentPage?.sheets.length ? ` · ${currentPage.sheets.join(" / ")}` : ""}
                {selected ? ` · ${selected.title}` : " · Full page"}
              </p>
              {loading || (canvas && !preview && drawingBoundsSchema.safeParse(bounds).success) ? (
                <p className="text-sm">Loading selected PDF page…</p>
              ) : preview ? (
                <img
                  src={preview}
                  alt={`Selected construction drawing crop — PDF page ${page}`}
                  className="w-full max-h-[620px] object-contain bg-white border"
                />
              ) : (
                <p className="text-sm">Choose a PDF page or matched room view.</p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Review this crop before using it. Adjust its edges to retain dimensions and exclude
                neighboring views.
              </p>
              <div className="flex gap-3 mt-3">
                <button
                  disabled={
                    disabled ||
                    loading ||
                    !preview ||
                    !drawingBoundsSchema.safeParse(bounds).success
                  }
                  className="bg-ink text-white px-4 py-3 text-sm disabled:opacity-40"
                  onClick={() => void choose("source")}
                >
                  Work on this view
                </button>
                <button
                  disabled={
                    disabled ||
                    loading ||
                    !preview ||
                    !drawingBoundsSchema.safeParse(bounds).success
                  }
                  className="border px-4 py-3 text-sm disabled:opacity-40"
                  onClick={() => void choose("support")}
                >
                  Add as supporting view
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 mt-3">
          {error}
        </p>
      )}
    </section>
  );
}
