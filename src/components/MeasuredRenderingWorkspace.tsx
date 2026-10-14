import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { MeasuredRenderingViewport } from "@/components/MeasuredRenderingViewport";
import { supabase } from "@/integrations/supabase/client";
import { studioHeaders } from "@/lib/measuredRequest";
import {
  elevationSchema,
  reconcileElevation,
  measuredRenderBrief,
  type MeasuredElevation,
  type MeasuredProductModel,
  type SpecSelection,
} from "@/lib/measuredRendering";
import { inspectGlb } from "@/lib/measuredModelFile";
import { ConstructionDrawingPicker } from "@/components/ConstructionDrawingPicker";
import type { DrawingCitation } from "@/lib/constructionDrawingViews";

type Model = MeasuredProductModel & { path?: string };
type Scene = {
  id: string;
  elevation: MeasuredElevation;
  sourcePath: string;
  sourceCitation?: DrawingCitation;
  supportCitations?: DrawingCitation[];
  supportPaths: string[];
  sourceUrl: string;
  basePath?: string;
  baseUrl?: string;
  qualityPath?: string;
  qualityUrl?: string;
  models: Model[];
  method: string;
  changed: boolean;
  presentationUrl?: string;
  presentationNotes: string[];
};
type HistoryJob = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  error?: string;
  imageUrl?: string;
  sceneId?: string;
};
type Capture = { image: string; camera: { type: string; position: number[]; target: number[] } };
export function MeasuredRenderingWorkspace({
  projectId,
  initialRoomId,
  embedded = false,
}: {
  projectId: string;
  initialRoomId?: string;
  embedded?: boolean;
}) {
  const [roomId, setRoomId] = useState(initialRoomId || ""),
    [rooms, setRooms] = useState<Array<{ id: string; name: string }>>([]),
    [name, setName] = useState("Project"),
    [items, setItems] = useState<SpecSelection[]>([]);
  const [scene, setScene] = useState<Scene | null>(null),
    [elevation, setElevation] = useState<MeasuredElevation | null>(null),
    [models, setModels] = useState<Model[]>([]),
    [front, setFront] = useState(true),
    [dirty, setDirty] = useState(false);
  const [source, setSource] = useState(""),
    [sourceCitation, setSourceCitation] = useState<DrawingCitation | undefined>(),
    [supportCitations, setSupportCitations] = useState<DrawingCitation[]>([]),
    [sourcePath, setSourcePath] = useState(""),
    [supportPaths, setSupportPaths] = useState<string[]>([]),
    [qualityPath, setQualityPath] = useState(""),
    [qualityUrl, setQualityUrl] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [showChecks, setShowChecks] = useState(false),
    [jobId, setJobId] = useState(""),
    [jobKind, setJobKind] = useState(""),
    [presentation, setPresentation] = useState(""),
    [presentationNotes, setPresentationNotes] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryJob[]>([]),
    [scenes, setScenes] = useState<Array<{ id: string; name: string; createdAt: string }>>([]),
    [selectedSceneId, setSelectedSceneId] = useState("");
  const capture = useRef<(() => Capture) | null>(null),
    generation = useRef(0),
    inFlight = useRef(false),
    operation = useRef<{ id: string; kind: string; key: string } | null>(null);
  const review = useMemo(
    () => (elevation ? reconcileElevation(elevation, items, models) : null),
    [elevation, items, models],
  );
  const query = `projectId=${encodeURIComponent(projectId)}${roomId ? "&roomId=" + encodeURIComponent(roomId) : ""}`;
  async function api(action?: Record<string, unknown>, extra = "") {
    const res = await fetch(`/api/measured-rendering?${query}${extra}`, {
      method: action ? "POST" : "GET",
      headers: await studioHeaders(),
      ...(action ? { body: JSON.stringify(action) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not complete this request.");
    return data;
  }
  function applyScene(s: Scene | null) {
    setScene(s);
    setElevation(s?.elevation || null);
    setModels(s?.models || []);
    setSource(s?.sourceUrl || "");
    setSourcePath(s?.sourcePath || "");
    setSourceCitation(s?.sourceCitation);
    setSupportCitations(s?.supportCitations || []);
    setSupportPaths(s?.supportPaths || []);
    setQualityPath(s?.qualityPath || "");
    setQualityUrl(s?.qualityUrl || "");
    setDirty(s?.changed || false);
    setSelectedSceneId(s?.id || "");
    setPresentation(s?.presentationUrl || "");
    setPresentationNotes(s?.presentationNotes || []);
  }
  async function refresh(extra = "") {
    const data = await api(undefined, extra);
    setItems(data.items || []);
    setScenes(data.scenes || []);
    setHistory(data.jobs || []);
    applyScene(data.scene || null);
    const active = (data.jobs || []).find(
      (j: HistoryJob) => j.status === "queued" || j.status === "processing",
    );
    if (active) {
      setJobId(active.id);
      setJobKind(active.kind);
      setBusy(active.kind);
    }
  }
  useEffect(() => {
    let active = true;
    (async () => {
      const headers = await studioHeaders();
      const res = await fetch(`/api/measured-rendering?projectId=${projectId}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (active) {
        setName(data.projectName);
        setRooms(data.rooms);
        if (!roomId)
          setRoomId(
            (
              data.rooms.find((r: { name: string }) => /primary bathroom/i.test(r.name)) ||
              data.rooms[0]
            )?.id || "",
          );
      }
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!roomId) return;
    const epoch = ++generation.current;
    setError("");
    setBusy("loading");
    setJobId("");
    applyScene(null);
    api()
      .then((data) => {
        if (epoch !== generation.current) return;
        setItems(data.items || []);
        setScenes(data.scenes || []);
        setHistory(data.jobs || []);
        applyScene(data.scene || null);
        const active = (data.jobs || []).find(
          (j: HistoryJob) => j.status === "queued" || j.status === "processing",
        );
        setBusy(active?.kind || "");
        if (active) {
          setJobId(active.id);
          setJobKind(active.kind);
        }
      })
      .catch((e) => {
        if (epoch === generation.current) {
          setError(e.message);
          setBusy("");
        }
      });
    return () => {
      generation.current++;
    };
  }, [roomId, projectId]);
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const data = await api(undefined, `&job=${jobId}`);
        if (!active) return;
        if (data.status === "complete") {
          setJobId("");
          setBusy("");
          operation.current = null;
          if (data.scene) {
            applyScene(data.scene);
          }
          if (data.imageUrl) {
            setPresentation(data.imageUrl);
            setPresentationNotes([
              "Generated from the saved measured camera and selected product photos. Compare fine geometry, materials and tile courses with the drawing before acceptance.",
            ]);
          }
          const list = await api();
          if (active) {
            setHistory(list.jobs || []);
            setScenes(list.scenes || []);
          }
        } else if (data.status === "failed") {
          setError(data.error || "Rendering could not finish.");
          setJobId("");
          setBusy("");
          operation.current = null;
        } else if (Date.now() - new Date(data.createdAt).getTime() > 15 * 60 * 1000) {
          setError(
            "This job is taking longer than expected. Its saved status remains in history; reopen it before starting another attempt.",
          );
          setBusy("");
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not read job status.");
          setBusy("");
        }
      } finally {
        polling = false;
      }
    }, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId, query]);
  async function upload(blob: Blob, mime = blob.type) {
    const grant = await api({ action: "upload", mime, size: blob.size });
    const { error } = await supabase.storage
      .from(grant.bucket)
      .uploadToSignedUrl(grant.path, grant.token, blob, { contentType: grant.contentType });
    if (error) throw error;
    return grant.path as string;
  }
  function working() {
    setDirty(true);
    setPresentation("");
    operation.current = null;
  }
  async function chooseImage(files: File[], kind: "source" | "support" | "quality") {
    if (!files.length) return;
    if (
      files.length > (kind === "support" ? 3 : 1) ||
      files.some(
        (f) =>
          !["image/png", "image/jpeg", "image/webp"].includes(f.type) || f.size > 15 * 1024 * 1024,
      )
    ) {
      setError("Choose PNG, JPG or WebP images under 15 MB; at most three supporting images.");
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const paths = await Promise.all(files.map((f) => upload(f)));
      working();
      if (kind === "source") {
        setSourceCitation(undefined);
        setSupportCitations([]);
        setSourcePath(paths[0]);
        setSource(URL.createObjectURL(files[0]));
        setElevation(null);
        setScene(null);
        setSupportPaths([]);
        setModels([]);
      } else if (kind === "support") {
        setSupportPaths(paths);
        setSupportCitations([]);
      } else {
        setQualityPath(paths[0]);
        setQualityUrl(URL.createObjectURL(files[0]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload drawing.");
    } finally {
      setBusy("");
    }
  }
  async function readDrawing() {
    if (inFlight.current || !sourcePath) return;
    inFlight.current = true;
    setBusy("interpret");
    setError("");
    try {
      const key = JSON.stringify([sourcePath, supportPaths]);
      if (operation.current?.kind !== "interpret" || operation.current.key !== key)
        operation.current = { id: crypto.randomUUID(), kind: "interpret", key };
      const data = await api({
        action: "interpret",
        operationId: operation.current.id,
        sourcePath,
        supportPaths,
        sourceCitation,
        supportCitations,
      });
      setJobId(data.jobId);
      setJobKind("interpret");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start drawing reading.");
      setBusy("");
    } finally {
      inFlight.current = false;
    }
  }
  async function saveCamera() {
    if (!elevation || !capture.current)
      throw new Error("Read the drawing and wait for the 3D view first.");
    const captured = capture.current();
    const basePath = await upload(await (await fetch(captured.image)).blob(), "image/png");
    const storedModels = [];
    for (const m of models) {
      const path =
        m.path || (await upload(await (await fetch(m.dataUrl)).blob(), "model/gltf-binary"));
      storedModels.push({
        specId: m.specId,
        path,
        filename: m.filename,
        sourceUrl: m.sourceUrl,
        confirmed: m.confirmed,
      });
    }
    const data = await api({
      action: "save-camera",
      sourceCitation,
      supportCitations,
      sourcePath,
      supportPaths,
      qualityPath: qualityPath || undefined,
      elevation,
      basePath,
      models: storedModels,
      camera: captured.camera,
      parentId: scene?.id,
    });
    applyScene(data.scene);
    setScenes((old) => [
      { id: data.scene.id, name: elevation.name, createdAt: new Date().toISOString() },
      ...old,
    ]);
    operation.current = null;
    return data.scene as Scene;
  }
  async function buildCamera() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("camera");
    setError("");
    try {
      await saveCamera();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save camera.");
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  async function photograph() {
    if (inFlight.current || !scene?.basePath || dirty) return;
    inFlight.current = true;
    setBusy("photoreal");
    setError("");
    try {
      const key = scene.id;
      if (operation.current?.kind !== "photoreal" || operation.current.key !== key)
        operation.current = { id: crypto.randomUUID(), kind: "photoreal", key };
      const data = await api({
        action: "photoreal",
        sceneId: scene.id,
        operationId: operation.current.id,
      });
      setJobId(data.jobId);
      setJobKind("photoreal");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start rendering.");
      setBusy("");
    } finally {
      inFlight.current = false;
    }
  }
  async function importModel(item: SpecSelection, file?: File) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Keep each product model under 10 MB.");
      inspectGlb(new Uint8Array(await file.arrayBuffer()));
      const reader = new FileReader();
      reader.onload = () => {
        setModels((old) => [
          ...old.filter((m) => m.specId !== item.id),
          {
            specId: item.id,
            dataUrl: "data:model/gltf-binary;base64," + String(reader.result).split(",")[1],
            filename: file.name,
            sourceUrl: item.productUrl || "",
            confirmed: false,
          },
        ]);
        working();
      };
      reader.readAsDataURL(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read model.");
    }
  }
  function correctMeasurement(id: string | null, axis: string, value: string) {
    if (!elevation) return;
    const n = value.trim() === "" && axis === "depth" && id === null ? null : Number(value);
    if (n !== null && !Number.isFinite(n)) {
      setError("Enter a measurement in inches.");
      return;
    }
    const proposed =
      id === null
        ? { ...elevation, [axis]: n }
        : {
            ...elevation,
            elements: elevation.elements.map((e) =>
              e.id === id
                ? {
                    ...e,
                    [axis]: n,
                    inferredAxes: e.inferredAxes.filter((a) => a !== axis),
                    dimensionEvidence: `${e.dimensionEvidence}; designer entered ${axis} ${n} inches`,
                  }
                : e,
            ),
          };
    const checked = elevationSchema.safeParse(proposed);
    if (!checked.success) {
      setError(
        "That measurement puts an element outside the elevation or is not a valid positive size. Check the drawing.",
      );
      return;
    }
    setElevation(checked.data);
    setError("");
    working();
  }
  async function chooseConstructionView(
    blob: Blob,
    citation: DrawingCitation,
    kind: "source" | "support",
  ) {
    if (kind === "support" && supportPaths.length >= 3)
      throw Error("Use at most three supporting views.");
    setBusy("upload");
    setError("");
    try {
      const path = await upload(blob, "image/png");
      working();
      if (kind === "source") {
        applyScene(null);
        working();
        setSourcePath(path);
        setSource(URL.createObjectURL(blob));
        setSourceCitation(citation);
        setSupportPaths([]);
        setSupportCitations([]);
        setModels([]);
      } else {
        setSupportPaths([...supportPaths, path]);
        setSupportCitations([...supportCitations, citation]);
      }
    } finally {
      setBusy("");
    }
  }
  return (
    <main className={embedded ? "max-w-[1560px] py-6" : "mx-auto max-w-[1560px] p-6 md:p-10"}>
      {!embedded && (
        <Link
          to="/projects/$id/renderings"
          params={{ id: projectId }}
          className="text-sm underline"
        >
          ← Renderings
        </Link>
      )}
      <div className="my-7 flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="eyebrow mb-2">MERAV STUDIO · {name}</p>
          <h1 className="font-display text-5xl">Drawing + Spec Book</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Build the measured view from your drawing, using Spec Book product dimensions. Then
            create the finished-room photograph.
          </p>
        </div>
        <p className="text-sm border p-3">
          {review ? `${review.changes.length} product dimension updates` : "Choose a room"}
        </p>
      </div>
      <div className="flex flex-wrap gap-4 items-end mb-6">
        <label className="text-sm">
          Room
          <select
            aria-label="Room"
            className="block mt-1 border p-2 min-w-48"
            value={roomId}
            disabled={!!busy}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">Choose room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Elevation image
          <input
            aria-label="Elevation image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!!busy}
            className="block mt-1 text-xs"
            onChange={(e) => void chooseImage(Array.from(e.target.files || []), "source")}
          />
        </label>
        <label className="text-sm">
          Supporting plans (optional)
          <input
            aria-label="Supporting plans"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            disabled={!!busy}
            className="block mt-1 text-xs"
            onChange={(e) => void chooseImage(Array.from(e.target.files || []), "support")}
          />
        </label>
        <button
          disabled={!sourcePath || !!busy}
          onClick={() => void readDrawing()}
          className="bg-ink text-white px-5 py-3 text-sm disabled:opacity-40"
        >
          Read drawing & match specs
        </button>
        <button
          disabled={!elevation || !!busy}
          onClick={() => void buildCamera()}
          className="bg-ink text-white px-5 py-3 text-sm disabled:opacity-40"
        >
          1. Build & save camera view
        </button>
        <button
          disabled={!scene?.basePath || dirty || !!busy}
          onClick={() => void photograph()}
          className="bg-ink text-white px-5 py-3 text-sm disabled:opacity-40"
        >
          2. Create photorealistic image
        </button>
      </div>
      {roomId && (
        <ConstructionDrawingPicker
          projectId={projectId}
          roomId={roomId}
          disabled={!!busy}
          onChoose={chooseConstructionView}
        />
      )}
      {sourceCitation && (
        <p className="text-xs mb-3">
          Working view: {sourceCitation.documentTitle} · {sourceCitation.sheet} ·{" "}
          {sourceCitation.title} · PDF page {sourceCitation.page}
        </p>
      )}
      {supportPaths.length > 0 && (
        <div className="text-xs mb-5">
          <span>
            {supportPaths.length} supporting view{supportPaths.length === 1 ? "" : "s"}
          </span>
          {supportCitations.map((c, i) => (
            <span key={`${c.sourceKey}-${c.viewId}-${i}`} className="ml-3">
              {c.sheet} · {c.title} · PDF {c.page}
            </span>
          ))}
          <button
            disabled={!!busy}
            className="underline ml-3"
            onClick={() => {
              setSupportPaths([]);
              setSupportCitations([]);
              working();
            }}
          >
            Clear supporting views
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-6 mb-6">
        <label className="text-sm">
          Photographic quality reference (optional)
          <input
            aria-label="Photographic quality reference"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!!busy}
            className="block mt-1 text-xs"
            onChange={(e) => void chooseImage(Array.from(e.target.files || []), "quality")}
          />
          {qualityUrl && (
            <img
              src={qualityUrl}
              className="w-32 h-20 object-cover border mt-2"
              alt="Photographic quality reference"
            />
          )}
        </label>
        {scenes.length > 0 && (
          <label className="text-sm">
            Saved camera / source versions
            <select
              aria-label="Saved scene"
              disabled={!!busy}
              className="block mt-1 border p-2 max-w-96"
              value={selectedSceneId}
              onChange={(e) => {
                setBusy("loading");
                refresh("&scene=" + e.target.value)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(""));
              }}
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {new Date(s.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {scene?.method === "manual-spec-k-quality-test" && (
        <p className="mb-4 border p-3 text-sm">
          Spec K reference test: the measured source was reconstructed manually and this quality
          sample was created in chat. New drawings use Studio's shared rendering workflow.
        </p>
      )}
      {dirty && elevation && (
        <p className="mb-4 text-sm">
          This view or Spec Book has changed. Build and save the camera view before creating its
          photograph.
        </p>
      )}
      {busy && (
        <p role="status" className="mb-4 text-sm">
          {busy === "interpret"
            ? "Reading the drawing and matching products…"
            : busy === "photoreal"
              ? "Creating the photograph. You can reopen its saved job later."
              : busy === "camera"
                ? "Saving the measured camera and sources…"
                : busy === "upload"
                  ? "Uploading original references…"
                  : "Loading saved project data…"}
        </p>
      )}
      {error && (
        <div role="alert" className="border border-red-200 bg-red-50 p-4 mb-6 text-sm">
          {error}
        </div>
      )}
      {presentation && (
        <section className="mb-8 border bg-white">
          <div className="p-4 flex justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl">Photorealistic presentation</h2>
              <p className="text-xs mt-1 text-muted-foreground">
                Selected-product references · Requires design review
              </p>
            </div>
            <a href={presentation} target="_blank" rel="noreferrer" className="text-sm underline">
              Open full image
            </a>
          </div>
          <img
            src={presentation}
            alt="Photorealistic room presentation"
            className="w-full max-h-[740px] object-contain"
          />
          <p className="p-4 text-xs text-muted-foreground">
            {presentationNotes.join(" ")} The measured scene remains the dimension reference; image
            generation can change fine geometry.
          </p>
        </section>
      )}
      {review && (
        <section className="border p-4 bg-bone/40 mb-6">
          <div className="flex justify-between gap-4">
            <strong className="text-sm">
              {review.ready
                ? "Source checks passed"
                : "Working preview — source and product details need review"}
            </strong>
            <button className="text-sm underline" onClick={() => setShowChecks(!showChecks)}>
              {showChecks ? "Hide checks" : "View source checks"} ({review.issues.length})
            </button>
          </div>
          <p className="text-xs mt-2 text-muted-foreground">
            Spec dimensions override drawing product sizes. Representative shapes and unresolved
            measurements stay flagged. Project selections and approvals are unchanged.
          </p>
          {showChecks && (
            <ul className="list-disc pl-5 text-xs mt-3 space-y-1">
              {review.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <section>
          <p className="eyebrow mb-3">Construction source</p>
          <div className="h-[520px] border bg-white flex items-center justify-center">
            {source ? (
              <img
                src={source}
                alt="Selected construction elevation"
                className="w-full h-full object-contain"
              />
            ) : (
              <p className="text-sm">Choose a room and its dimensioned elevation.</p>
            )}
          </div>
        </section>
        <section>
          <div className="flex justify-between gap-4 mb-3">
            <p className="eyebrow">Measured 3D view</p>
            <div className="flex gap-3 text-xs">
              <button
                onClick={() => {
                  setFront(true);
                  working();
                }}
              >
                Elevation
              </button>
              <button
                onClick={() => {
                  setFront(false);
                  working();
                }}
              >
                Perspective
              </button>
              {scene?.baseUrl && (
                <a href={scene.baseUrl} target="_blank" rel="noreferrer" className="underline">
                  Saved camera image
                </a>
              )}
            </div>
          </div>
          {elevation && review ? (
            <MeasuredRenderingViewport
              elevation={elevation}
              review={review}
              front={front}
              models={models}
              captureRef={capture}
              onViewChange={working}
            />
          ) : (
            <div className="h-[520px] border flex items-center justify-center text-sm">
              Read the drawing to build the view.
            </div>
          )}
        </section>
      </div>
      {elevation && review && (
        <>
          <h2 className="font-display text-3xl mt-10 mb-4">Drawing → Spec Book</h2>
          <details className="border p-4 mb-5">
            <summary className="text-sm cursor-pointer">
              Correct source measurements (inches)
            </summary>
            <p className="text-xs mt-3 mb-4">
              Use written drawing dimensions to correct the measured source. Spec Book product
              dimensions still take precedence.
            </p>
            <div className="flex gap-4 flex-wrap mb-4">
              {(["width", "height", "depth"] as const).map((axis) => (
                <label className="text-xs" key={axis}>
                  Room {axis}
                  <input
                    aria-label={`Room ${axis}`}
                    key={`${selectedSceneId}-${axis}-${elevation[axis]}`}
                    type="number"
                    step="any"
                    defaultValue={elevation[axis] ?? ""}
                    placeholder="Unknown"
                    disabled={!!busy}
                    onBlur={(e) => correctMeasurement(null, axis, e.target.value)}
                    className="block border p-2 mt-1 w-28"
                  />
                </label>
              ))}
            </div>
            <div className="overflow-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr>
                    <th className="text-left p-2">Element</th>
                    {["x centre", "bottom y", "front z", "width", "height", "depth"].map(
                      (label) => (
                        <th key={label} className="p-2">
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {elevation.elements.map((element) => (
                    <tr key={element.id} className="border-t">
                      <td className="p-2">{element.name}</td>
                      {(["x", "y", "z", "width", "height", "depth"] as const).map((axis) => (
                        <td key={axis} className="p-1">
                          <input
                            key={`${element.id}-${axis}-${element[axis]}`}
                            aria-label={`${element.name} ${axis}`}
                            className="border p-2 w-24"
                            type="number"
                            step="any"
                            defaultValue={element[axis]}
                            disabled={!!busy}
                            onBlur={(e) => correctMeasurement(element.id, axis, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="overflow-auto border">
            <table className="w-full text-sm">
              <thead className="bg-bone text-left">
                <tr>
                  {["Element", "Selected product", "Drawing size", "Built size"].map((h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {review.elements
                  .filter((e) => e.specId || !["wall", "glass"].includes(e.kind))
                  .map((e) => {
                    const before = elevation.elements.find((b) => b.id === e.id)!;
                    return (
                      <tr key={e.id} className="border-t">
                        <td className="p-3">{e.name}</td>
                        <td className="p-3">
                          <select
                            aria-label={`Product for ${e.name}`}
                            value={e.specId || ""}
                            disabled={!!busy}
                            className="max-w-72 border p-2"
                            onChange={(event) => {
                              setElevation({
                                ...elevation,
                                elements: elevation.elements.map((item) =>
                                  item.id === e.id
                                    ? { ...item, specId: event.target.value || null }
                                    : item,
                                ),
                              });
                              working();
                            }}
                          >
                            <option value="">Choose selection</option>
                            {items.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.label} · {i.name}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs">{e.selection?.finish}</p>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {before.width}″ × {before.height}″ × {before.depth}″
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {e.width}″ × {e.height}″ × {e.depth}″
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <h2 className="font-display text-3xl mt-10 mb-4">Product references</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {items
              .filter((i) => review.elements.some((e) => e.specId === i.id))
              .map((item) => {
                const model = models.find((m) => m.specId === item.id);
                return (
                  <article className="border p-4" key={item.id}>
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-44 object-contain mb-3"
                      />
                    )}
                    <p className="text-xs uppercase tracking-wide">{item.label}</p>
                    <p className="text-sm mt-1">{item.name}</p>
                    <p className="text-xs mt-1">
                      {item.finish} · {item.dimensions || "Dimensions missing"}
                    </p>
                    <label className="block mt-3 text-xs">
                      Product 3D model (.glb)
                      <input
                        aria-label={`Model for ${item.label}`}
                        type="file"
                        accept=".glb"
                        disabled={!!busy}
                        className="block mt-1 text-xs"
                        onChange={(e) => void importModel(item, e.target.files?.[0])}
                      />
                    </label>
                    {model && (
                      <>
                        <p className="text-xs mt-2">{model.filename}</p>
                        <label className="text-xs block mt-2">
                          <input
                            type="checkbox"
                            checked={model.confirmed}
                            onChange={(e) => {
                              setModels((old) =>
                                old.map((m) =>
                                  m.specId === item.id ? { ...m, confirmed: e.target.checked } : m,
                                ),
                              );
                              working();
                            }}
                          />{" "}
                          I checked this model matches this product and finish.
                        </label>
                        <button
                          className="text-xs underline mt-2"
                          onClick={() => {
                            setModels((old) => old.filter((m) => m.specId !== item.id));
                            working();
                          }}
                        >
                          Remove model
                        </button>
                      </>
                    )}
                  </article>
                );
              })}
          </div>
        </>
      )}
      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-3xl mb-4">Saved rendering jobs</h2>
          <div className="space-y-3">
            {history.map((j) => (
              <div className="border p-4 flex flex-wrap justify-between gap-3 text-sm" key={j.id}>
                <div>
                  <p>
                    {j.kind === "photoreal" ? "Photorealistic image" : "Drawing reading"} ·{" "}
                    {j.status} · {new Date(j.createdAt).toLocaleString()}
                  </p>
                  {j.error && <p className="text-xs text-red-700 mt-1">{j.error}</p>}
                </div>
                {j.imageUrl && (
                  <button
                    className="underline"
                    onClick={() => {
                      setPresentation(j.imageUrl!);
                      setPresentationNotes([
                        "Saved presentation draft. Match this image to its saved camera version before review.",
                      ]);
                    }}
                  >
                    View image
                  </button>
                )}
                {["queued", "processing"].includes(j.status) && (
                  <button
                    className="underline"
                    onClick={() => {
                      setJobId(j.id);
                      setJobKind(j.kind);
                      setBusy(j.kind);
                    }}
                  >
                    Follow job
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
