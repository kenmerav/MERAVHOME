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
import { measuredLayoutIssues, measuredSpatialNotes } from "@/lib/measuredSpatial";
import { ConstructionDrawingPicker } from "@/components/ConstructionDrawingPicker";
import type { DrawingCitation } from "@/lib/constructionDrawingViews";
import { MeasuredRenderingProgress, type RenderingProgressJob } from "./MeasuredRenderingProgress";
import { useQueryClient } from "@tanstack/react-query";
import {
  MeasuredRenderingImagePanel,
  type SavedMeasuredRendering,
} from "./MeasuredRenderingImagePanel";

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
  sceneName?: string;
  updatedAt?: string;
  sourceCitation?: DrawingCitation;
  parentJobId?: string;
  revisionNotes?: string;
  revisionNumber?: number;
  savedRendering?: SavedMeasuredRendering | null;
};
type Capture = { image: string; camera: { type: string; position: number[]; target: number[] } };
export function MeasuredRenderingWorkspace({
  projectId,
  initialRoomId,
  embedded = false,
  onOpenGallery,
}: {
  projectId: string;
  initialRoomId?: string;
  embedded?: boolean;
  onOpenGallery?: (roomId: string) => void;
}) {
  const queryClient = useQueryClient();
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
    [presentationJobId, setPresentationJobId] = useState(""),
    [presentationNotes, setPresentationNotes] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryJob[]>([]),
    [scenes, setScenes] = useState<Array<{ id: string; name: string; createdAt: string }>>([]),
    [selectedSceneId, setSelectedSceneId] = useState("");
  const [progressJob, setProgressJob] = useState<RenderingProgressJob | null>(null),
    [activityStartedAt, setActivityStartedAt] = useState(""),
    [lastCheckedAt, setLastCheckedAt] = useState(""),
    [checkingStatus, setCheckingStatus] = useState(false),
    [startingRequest, setStartingRequest] = useState(false),
    [savedViewNotice, setSavedViewNotice] = useState(""),
    [statusError, setStatusError] = useState("");
  const statusRequest = useRef("");
  const currentJob = useRef("");
  const capture = useRef<(() => Capture) | null>(null),
    generation = useRef(0),
    inFlight = useRef(false),
    operation = useRef<{ id: string; kind: string; key: string } | null>(null);
  const review = useMemo(
    () => (elevation ? reconcileElevation(elevation, items, models) : null),
    [elevation, items, models],
  );
  const displayedJob = history.find((j) => j.id === presentationJobId);
  const layoutIssues = useMemo(
    () => (elevation ? measuredLayoutIssues(elevation) : []),
    [elevation],
  );
  const spatialNotes = useMemo(
    () => (elevation ? measuredSpatialNotes(elevation) : []),
    [elevation],
  );
  const query = `projectId=${encodeURIComponent(projectId)}${roomId ? "&roomId=" + encodeURIComponent(roomId) : ""}`;
  async function api(action?: Record<string, unknown>, extra = "") {
    const res = await fetch(`/api/measured-rendering?${query}${extra}`, {
      method: action ? "POST" : "GET",
      headers: await studioHeaders(),
      signal: AbortSignal.timeout(action ? 60000 : 30000),
      ...(action ? { body: JSON.stringify(action) } : {}),
    });
    const data = await res.json();
    if (!res.ok)
      throw Object.assign(new Error(data.error || "Could not complete this request."), {
        status: res.status,
      });
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
    setPresentationJobId("");
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
      currentJob.current = active.id;
      setJobId(active.id);
      setJobKind(active.kind);
      setBusy(active.kind);
      setProgressJob(active);
      setLastCheckedAt(new Date().toISOString());
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
    currentJob.current = "";
    setProgressJob(null);
    setSavedViewNotice("");
    setStatusError("");
    setCheckingStatus(false);
    setLastCheckedAt("");
    statusRequest.current = "";
    setActivityStartedAt(new Date().toISOString());
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
          currentJob.current = active.id;
          setJobId(active.id);
          setJobKind(active.kind);
          setProgressJob(active);
          setLastCheckedAt(new Date().toISOString());
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
  async function checkJobStatus(id = jobId || operation.current?.id || progressJob?.id) {
    if (!id || currentJob.current !== id) return;
    const key = `${query}:${id}`,
      epoch = generation.current;
    if (statusRequest.current === key) return;
    statusRequest.current = key;
    setCheckingStatus(true);
    try {
      const data = await api(undefined, `&job=${encodeURIComponent(id)}`);
      if (epoch !== generation.current || currentJob.current !== id) return;
      setProgressJob(data);
      setLastCheckedAt(new Date().toISOString());
      setStatusError("");
      setHistory((old) =>
        old.map((j) =>
          j.id === id
            ? { ...j, status: data.status, updatedAt: data.updatedAt, error: data.error }
            : j,
        ),
      );
      if (data.status === "complete") {
        setJobId("");
        setBusy("");
        operation.current = null;
        if (data.scene) {
          applyScene(data.scene);
        }
        if (data.imageUrl) {
          setPresentation(data.imageUrl);
          setPresentationJobId(data.id);
          setPresentationNotes([
            "Generated from the saved measured camera and selected product photos. Compare fine geometry, materials and tile courses with the drawing before acceptance.",
          ]);
        }
        const list = await api();
        if (epoch === generation.current && currentJob.current === id) {
          setHistory(list.jobs || []);
          setScenes(list.scenes || []);
        }
      } else if (data.status === "failed") {
        setError(data.error || "Rendering could not finish.");
        setJobId("");
        setBusy("");
        operation.current = null;
      } else {
        setJobId(id);
        setJobKind(data.kind);
        setBusy(data.kind);
      }
    } catch (e) {
      if (epoch === generation.current && currentJob.current === id) {
        setStatusError(
          "Could not update the saved status. Check again or reopen this room. No new read or image was started.",
        );
      }
    } finally {
      if (statusRequest.current === key) {
        statusRequest.current = "";
        if (epoch === generation.current && currentJob.current === id) setCheckingStatus(false);
      }
    }
  }
  useEffect(() => {
    if (!jobId) return;
    void checkJobStatus(jobId);
    const timer = setInterval(() => void checkJobStatus(jobId), 2500);
    return () => {
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
    setPresentationJobId("");
    operation.current = null;
    setSavedViewNotice("");
    if (!jobId) {
      setProgressJob(null);
      currentJob.current = "";
    }
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
    setActivityStartedAt(new Date().toISOString());
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
    setStartingRequest(true);
    const epoch = generation.current;
    let requestId = "";
    setBusy("interpret");
    const startedAt = new Date().toISOString();
    setActivityStartedAt(startedAt);
    setLastCheckedAt("");
    setStatusError("");
    setError("");
    try {
      const key = JSON.stringify([sourcePath, supportPaths]);
      if (operation.current?.kind !== "interpret" || operation.current.key !== key)
        operation.current = { id: crypto.randomUUID(), kind: "interpret", key };
      requestId = operation.current.id;
      currentJob.current = requestId;
      setProgressJob({
        id: operation.current.id,
        kind: "interpret",
        status: "starting",
        createdAt: startedAt,
        sourceCitation,
      });
      const data = await api({
        action: "interpret",
        operationId: operation.current.id,
        sourcePath,
        supportPaths,
        sourceCitation,
        supportCitations,
      });
      if (epoch !== generation.current || operation.current?.id !== requestId) return;
      setJobId(data.jobId);
      setJobKind("interpret");
      const job = {
        id: data.jobId,
        kind: "interpret",
        status: data.status,
        createdAt: data.createdAt || startedAt,
        updatedAt: data.updatedAt,
        sourceCitation,
      };
      setProgressJob(job);
      setHistory((old) => [job, ...old.filter((j) => j.id !== job.id)]);
    } catch (e) {
      if (epoch !== generation.current || operation.current?.id !== requestId) return;
      setError(e instanceof Error ? e.message : "Could not start drawing reading.");
      setBusy("");
      setProgressJob((old) => (old ? { ...old, status: "unknown" } : null));
    } finally {
      inFlight.current = false;
      setStartingRequest(false);
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
    setActivityStartedAt(new Date().toISOString());
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
  async function photograph(revision?: { parentJobId: string; revisionNotes: string }) {
    if (layoutIssues.length) {
      setError(layoutIssues.join(" "));
      return false;
    }
    if (inFlight.current || (!revision && (!scene?.basePath || dirty))) return false;
    inFlight.current = true;
    setStartingRequest(true);
    const epoch = generation.current;
    let requestId = "";
    setBusy("photoreal");
    const startedAt = new Date().toISOString();
    setActivityStartedAt(startedAt);
    setLastCheckedAt("");
    setStatusError("");
    setError("");
    try {
      const key = revision ? JSON.stringify(revision) : scene!.id;
      if (operation.current?.kind !== "photoreal" || operation.current.key !== key)
        operation.current = { id: crypto.randomUUID(), kind: "photoreal", key };
      requestId = operation.current.id;
      currentJob.current = requestId;
      setProgressJob({
        id: operation.current.id,
        kind: "photoreal",
        status: "starting",
        createdAt: startedAt,
        sourceCitation,
      });
      const data = await api({
        action: "photoreal",
        sceneId: revision ? undefined : scene!.id,
        ...revision,
        operationId: operation.current.id,
      });
      if (epoch !== generation.current || operation.current?.id !== requestId) return false;
      setJobId(data.jobId);
      setJobKind("photoreal");
      const job = {
        id: data.jobId,
        kind: "photoreal",
        status: data.status,
        createdAt: data.createdAt || startedAt,
        updatedAt: data.updatedAt,
        sourceCitation,
        parentJobId: revision?.parentJobId,
        revisionNotes: revision?.revisionNotes,
        revisionNumber: revision ? (displayedJob?.revisionNumber || 1) + 1 : 1,
      };
      setProgressJob(job);
      setHistory((old) => [job, ...old.filter((j) => j.id !== job.id)]);
      return true;
    } catch (e) {
      if (epoch !== generation.current || operation.current?.id !== requestId) return false;
      setError(e instanceof Error ? e.message : "Could not start rendering.");
      setBusy("");
      const rejected =
        typeof (e as { status?: number })?.status === "number" &&
        (e as { status: number }).status < 500;
      setProgressJob((old) => (old ? { ...old, status: rejected ? "failed" : "unknown" } : null));
      if (rejected) {
        operation.current = null;
        currentJob.current = "";
      }
      return false;
    } finally {
      inFlight.current = false;
      setStartingRequest(false);
    }
  }
  async function saveRendering(caption: string, approve: boolean) {
    const epoch = generation.current,
      id = presentationJobId;
    if (!id) throw new Error("Choose a completed image first.");
    const data = await api({ action: "save-rendering", jobId: id, caption, approve });
    void queryClient.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["roomImages", roomId] });
    if (epoch !== generation.current) return;
    setHistory((old) =>
      old.map((j) => (j.id === id ? { ...j, savedRendering: data.rendering } : j)),
    );
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
    setActivityStartedAt(new Date().toISOString());
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
          {!embedded && <p className="eyebrow mb-2">MERAV STUDIO · {name}</p>}
          {embedded ? (
            <h2 className="font-display text-4xl">Create a rendering</h2>
          ) : (
            <h1 className="font-display text-5xl">Rendering Studio</h1>
          )}
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Build the measured view from your drawing, using Spec Book product dimensions. Then
            create the finished-room photograph.
          </p>
        </div>
        <p className="text-sm border p-3">
          {review ? `${review.changes.length} product dimension updates` : "Choose a room"}
        </p>
      </div>
      {(busy || progressJob) && (
        <MeasuredRenderingProgress
          job={progressJob}
          busy={busy}
          startedAt={activityStartedAt}
          lastCheckedAt={lastCheckedAt}
          checking={checkingStatus}
          statusError={statusError}
          previousView={!!scene}
          onCheck={progressJob ? () => void checkJobStatus(progressJob.id) : undefined}
          onNext={
            elevation &&
            !busy &&
            !startingRequest &&
            (!(scene?.basePath && !dirty) || layoutIssues.length === 0) &&
            progressJob?.status === "complete" &&
            progressJob.kind === "interpret"
              ? scene?.basePath && !dirty
                ? () => void photograph()
                : () => void buildCamera()
              : undefined
          }
          nextLabel={
            scene?.basePath && !dirty ? "Create photorealistic image" : "Build & save camera view"
          }
          onUseSavedCamera={
            jobId && progressJob?.kind === "interpret" && scene?.basePath && !startingRequest
              ? () => {
                  setJobId("");
                  currentJob.current = "";
                  setBusy("");
                  setProgressJob(null);
                  setError("");
                  setCheckingStatus(false);
                  setStatusError("");
                  statusRequest.current = "";
                  operation.current = null;
                  setSavedViewNotice(
                    "The drawing read continues in the background. You are using your previous saved camera. Choose Follow job in saved rendering jobs to check the new result.",
                  );
                }
              : undefined
          }
        />
      )}
      {savedViewNotice && (
        <p role="status" className="mb-6 border p-4 text-sm">
          {savedViewNotice}
        </p>
      )}
      <div className="flex flex-wrap gap-4 items-end mb-6">
        <label className="text-sm">
          Room
          <select
            aria-label="Room"
            className="block mt-1 border p-2 min-w-48"
            value={roomId}
            disabled={startingRequest || ["loading", "camera", "upload"].includes(busy)}
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
          disabled={
            !sourcePath ||
            !!busy ||
            startingRequest ||
            (!!savedViewNotice &&
              history.some(
                (j) => j.kind === "interpret" && ["queued", "processing"].includes(j.status),
              ))
          }
          onClick={() => void readDrawing()}
          className="bg-ink text-white px-5 py-3 text-sm disabled:opacity-40"
        >
          Read drawing & match specs
        </button>
        <button
          disabled={!elevation || !!busy || startingRequest}
          onClick={() => void buildCamera()}
          className="bg-ink text-white px-5 py-3 text-sm disabled:opacity-40"
        >
          1. Build & save camera view
        </button>
        <button
          disabled={
            !scene?.basePath || dirty || !!busy || startingRequest || layoutIssues.length > 0
          }
          onClick={() => void photograph()}
          className="bg-ink text-white px-5 py-3 text-sm disabled:opacity-40"
        >
          2. Create photorealistic image
        </button>
      </div>
      {layoutIssues.length > 0 && (
        <section
          role="status"
          aria-label="Layout confirmation needed"
          className="border border-amber-300 bg-amber-50 p-4 mt-4 mb-6 text-sm"
        >
          <strong>Confirm island / freestanding layout before creating an image</strong>
          {layoutIssues.map((issue) => (
            <p key={issue} className="mt-2">
              {issue}
            </p>
          ))}
          <p className="mt-2">
            You can browse the PDF and add the plan with “Add as supporting view.” The elevation
            preview can still be saved.
          </p>
        </section>
      )}
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
              {!selectedSceneId && <option value="">New selected view — not saved yet</option>}
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
      {error && (
        <div role="alert" className="border border-red-200 bg-red-50 p-4 mb-6 text-sm">
          {error}
        </div>
      )}
      {presentation && (
        <MeasuredRenderingImagePanel
          key={presentationJobId || presentation}
          projectId={projectId}
          imageUrl={presentation}
          jobId={presentationJobId}
          defaultName={`${rooms.find((r) => r.id === roomId)?.name || "Room"} · ${displayedJob?.sceneName || elevation?.name || "Rendering"} · v${displayedJob?.revisionNumber || 1}`}
          notes={presentationNotes}
          revisionNotes={displayedJob?.revisionNotes}
          revisionNumber={displayedJob?.revisionNumber}
          savedRendering={displayedJob?.savedRendering}
          busy={!!busy || startingRequest || progressJob?.status === "unknown"}
          revisionBlockedReason={layoutIssues.length ? layoutIssues.join(" ") : undefined}
          onSave={saveRendering}
          onRevise={(revisionNotes) =>
            photograph({ parentJobId: presentationJobId, revisionNotes })
          }
          onOpenGallery={onOpenGallery ? () => onOpenGallery(roomId) : undefined}
        />
      )}
      {spatialNotes.length > 0 && (
        <section className="border p-4 mb-6 text-sm" aria-label="Drawing layout notes">
          <strong>Drawing layout notes</strong>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            {spatialNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
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
                    {j.kind === "photoreal" ? `Version ${j.revisionNumber || 1} · ` : ""}
                    {j.status} · {new Date(j.createdAt).toLocaleString()}
                  </p>
                  {j.revisionNotes && (
                    <p className="text-xs mt-2 whitespace-pre-wrap">Requested: {j.revisionNotes}</p>
                  )}
                  {j.savedRendering && (
                    <p className="text-xs mt-1">
                      Saved to room renderings · {j.savedRendering.review_status}
                    </p>
                  )}
                  {j.error && <p className="text-xs text-red-700 mt-1">{j.error}</p>}
                </div>
                {j.imageUrl && (
                  <button
                    className="underline"
                    onClick={() => {
                      setPresentation(j.imageUrl!);
                      setPresentationJobId(j.id);
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
                      currentJob.current = j.id;
                      setSavedViewNotice("");
                      setJobId(j.id);
                      setJobKind(j.kind);
                      setBusy(j.kind);
                      setProgressJob(j);
                      setStatusError("");
                      void checkJobStatus(j.id);
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
