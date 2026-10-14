import { useEffect, useRef, useState } from "react";
import { studioHeaders } from "@/lib/measuredRequest";
import {
  drawingBoundsSchema,
  type ConstructionDrawingView,
  type DrawingBounds,
  type DrawingCitation,
} from "@/lib/constructionDrawingViews";
import {
  openConstructionPdf,
  previewConstructionPage,
  cropConstructionPage,
} from "@/lib/constructionPdfPreview";

type DrawingData = {
  documents: { id: string; title: string; updatedAt: string }[];
  document?: { id: string; title: string; key: string; url: string };
  views?: ConstructionDrawingView[];
  status?: string;
  error?: string;
  pages?: number;
};
const fullPage: DrawingBounds = { left: 0, top: 0, right: 1, bottom: 1 };
export function ConstructionDrawingPicker({
  projectId,
  roomId,
  disabled,
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
  const [pdf, setPdf] = useState<Awaited<ReturnType<typeof openConstructionPdf>> | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null),
    [preview, setPreview] = useState("");
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [starting, setStarting] = useState(false);
  const epoch = useRef(0);
  async function request(action?: Record<string, unknown>, doc = documentId) {
    const url = `/api/measured-rendering?projectId=${projectId}&roomId=${roomId}&drawings=1${doc ? `&documentId=${doc}` : ""}`;
    const response = await fetch(url, {
      headers: await studioHeaders(),
      method: action ? "POST" : "GET",
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
    const refresh = async () => {
      try {
        const result = await request();
        if (!active || version !== epoch.current) return;
        setData(result);
        if (!documentId && result.documents?.length) setDocumentId(result.documents[0].id);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not read drawings.");
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, roomId, documentId]);
  const documentKey = data.document?.key;
  useEffect(() => {
    let active = true;
    let loaded: Awaited<ReturnType<typeof openConstructionPdf>> | null = null;
    setPdf(null);
    setCanvas(null);
    setPreview("");
    if (data.document) {
      setLoading(true);
      openConstructionPdf(data.document.url)
        .then((result) => {
          loaded = result;
          if (active) setPdf(result);
          else void result.destroy();
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
      if (loaded) void loaded.destroy();
    };
  }, [documentKey]);
  useEffect(() => {
    let active = true;
    setCanvas(null);
    setPreview("");
    if (pdf) {
      setLoading(true);
      previewConstructionPage(pdf, page)
        .then((result) => {
          if (active) setCanvas(result);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [pdf, page]);
  useEffect(() => {
    let active = true,
      url = "";
    if (canvas && drawingBoundsSchema.safeParse(bounds).success) {
      cropConstructionPage(canvas, bounds)
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (active) setPreview(url);
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
  }, [canvas, bounds]);
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
  const selected = data.views?.find((v) => v.id === viewId);
  async function choose(kind: "source" | "support") {
    if (!canvas || !data.document) return;
    setError("");
    try {
      const blob = await cropConstructionPage(canvas, bounds);
      await onChoose(
        blob,
        {
          documentId: data.document.id,
          documentTitle: data.document.title,
          sourceKey: data.document.key,
          viewId: viewId || `manual-page-${page}`,
          title: selected?.title || `Manually selected PDF page ${page}`,
          sheet: selected?.sheet || "Manual page selection",
          page,
          bounds,
        },
        kind,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use this view.");
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
      {!data.documents.length ? (
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
              <label className="text-sm">
                Views matching this room
                <select
                  aria-label="Construction view"
                  className="block border p-2 mt-1 w-full"
                  disabled={disabled || !data.views?.length}
                  value={viewId}
                  onChange={(e) => {
                    const view = data.views?.find((v) => v.id === e.target.value);
                    setViewId(e.target.value);
                    if (view) {
                      setPage(view.page);
                      setBounds(view.bounds);
                    }
                  }}
                >
                  <option value="">Choose a view</option>
                  {data.views?.map((v, index) => (
                    <option key={v.id} value={v.id}>
                      {v.sheet} · {v.title}
                      {data.views!.filter(
                        (other) =>
                          other.sheet === v.sheet &&
                          other.title === v.title &&
                          other.page === v.page,
                      ).length > 1
                        ? ` · View ${index + 1}`
                        : ""}{" "}
                      · PDF {v.page}
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
              <details className="mt-4" open={!viewId}>
                <summary className="text-sm cursor-pointer">
                  Browse PDF / adjust drawing crop
                </summary>
                <label className="text-xs block mt-3">
                  PDF page
                  <input
                    aria-label="Construction PDF page"
                    className="border p-2 block w-24"
                    type="number"
                    min={1}
                    max={pdf?.numPages || 1}
                    disabled={disabled || !pdf}
                    value={page}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1 && n <= (pdf?.numPages || 1)) {
                        setPage(n);
                        setViewId("");
                        setBounds(fullPage);
                      }
                    }}
                  />
                </label>
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
              {loading ? (
                <p className="text-sm">Loading selected PDF page…</p>
              ) : preview ? (
                <img
                  src={preview}
                  alt="Selected construction drawing crop"
                  className="w-full max-h-[430px] object-contain bg-white border"
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
