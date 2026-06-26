import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Sparkles, Plus, Trash2, Star, RefreshCw, Download, Eye, CheckCircle2, Loader2, AlertCircle, Circle, Clock, GitBranch, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, type RoomImage, type RenderingStatus, type RenderingReviewStatus, type RoomProduct, type Material } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { resolveImage } from "@/lib/local-assets";
import { compressImageSource, fileToCompressedDataUrl } from "@/lib/imagePayload";
import { resolveStaleRenderingJobs } from "@/lib/renderingJobs";
import { toast } from "sonner";

async function persistRoomImageUrl(roomId: string, kind: "sketchup" | "rendering", value: string, fileName?: string) {
  if (!value.startsWith("data:image/")) return value.trim();
  const res = await fetch("/api/upload-room-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, kind, dataUrl: value, fileName }),
  });
  const body = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || "Could not upload image");
  return body.url;
}

export const Route = createFileRoute("/projects/$id/renderings")({
  head: () => ({ meta: [{ title: "Renderings — MERAV Studio" }] }),
  component: ProjectRenderingsPage,
});

function ProjectRenderingsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => db.getProject(id) });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", id], queryFn: async () => (await db.listRooms(id)) ?? [] });
  const { data: allImages = [] } = useQuery({
    queryKey: ["projectRoomImages", id],
    queryFn: async () => resolveStaleRenderingJobs((await db.listProjectRoomImages(id)) ?? []),
    refetchInterval: 4000,
  });

  const [busy, setBusy] = useState(false);

  // Build per-room data
  const byRoom = useMemo(() => {
    const map = new Map<string, { sketchups: RoomImage[]; renderings: RoomImage[] }>();
    for (const r of rooms) map.set(r.id, { sketchups: [], renderings: [] });
    for (const img of allImages as RoomImage[]) {
      const entry = map.get(img.room_id);
      if (!entry) continue;
      if (img.kind === "sketchup") entry.sketchups.push(img);
      else entry.renderings.push(img);
    }
    return map;
  }, [rooms, allImages]);

  const totals = useMemo(() => {
    let sk = 0, done = 0, pending = 0, failed = 0;
    for (const r of rooms) {
      const { sketchups } = byRoom.get(r.id) || { sketchups: [], renderings: [] };
      for (const s of sketchups) {
        sk++;
        const st = sketchupStatus(s.id, byRoom.get(r.id)!.renderings);
        if (st === "complete") done++;
        else if (st === "failed") failed++;
        else if (st !== "not_generated") pending++;
      }
    }
    return { sk, done, pending, failed };
  }, [rooms, byRoom]);

  const generateAll = async () => {
    if (busy) return;
    setBusy(true);
    // Collect all sketchups that don't have a successful rendering
    const tasks: { roomId: string; sk: RoomImage }[] = [];
    for (const r of rooms) {
      const { sketchups, renderings } = byRoom.get(r.id) || { sketchups: [], renderings: [] };
      for (const sk of sketchups) {
        const hasComplete = renderings.some(rn => rn.linked_sketchup_id === sk.id && rn.status === "complete");
        if (!hasComplete) tasks.push({ roomId: r.id, sk });
      }
    }
    if (!tasks.length) {
      toast.info("Nothing to generate");
      setBusy(false);
      return;
    }
  toast.success(`Queueing ${tasks.length} rendering${tasks.length === 1 ? "" : "s"}…`);
  for (const t of tasks) {
    await generateRendering(t.roomId, t.sk, qc, id);
  }
  setBusy(false);
  toast.success("Batch queued");
  };

  if (!project) return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;

  const progress = totals.sk === 0 ? 0 : Math.round((totals.done / totals.sk) * 100);

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <Link to="/projects/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> {project.name}
        </Link>

        <div className="flex items-end justify-between mb-8 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">{project.client_name} · {project.name}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">AI Renderings</h1>
            <p className="text-sm text-muted-foreground mt-3 max-w-2xl">
              Upload SketchUp views for each room, then generate photoreal renderings for the entire project at once. Approved renderings flow into the Presentation Generator.
            </p>
          </div>
          <button
            disabled={busy || totals.sk === 0}
            onClick={generateAll}
            className={cn(
              "px-5 py-3 text-sm inline-flex items-center gap-2",
              busy || totals.sk === 0 ? "bg-bone text-muted-foreground cursor-not-allowed" : "bg-ink text-primary-foreground hover:opacity-90"
            )}
          >
            <Sparkles className="w-4 h-4" />
            {busy ? "Generating…" : `Generate All Renderings (${totals.sk - totals.done})`}
          </button>
        </div>

        {/* Progress strip */}
        <div className="border border-border bg-bone/40 p-5 mb-12">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="eyebrow">Project Progress</span>
            <span className="text-muted-foreground">
              {totals.done} of {totals.sk} renderings complete
              {totals.pending > 0 && ` · ${totals.pending} in progress`}
              {totals.failed > 0 && ` · ${totals.failed} failed`}
            </span>
          </div>
          <Progress value={progress} />
        </div>

        {rooms.length === 0 ? (
          <div className="border border-dashed border-border py-20 text-center text-muted-foreground">
            Add rooms to your project to start uploading SketchUp images.
          </div>
        ) : (
          <div className="space-y-16">
            {rooms.map(r => (
              <RoomRenderingSection
                key={r.id}
                room={r}
                projectId={id}
                sketchups={byRoom.get(r.id)?.sketchups ?? []}
                renderings={byRoom.get(r.id)?.renderings ?? []}
                disableActions={busy}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ─────────── Per-room section ─────────── */
function RoomRenderingSection({ room, projectId, sketchups, renderings, disableActions }: {
  room: { id: string; name: string }; projectId: string; sketchups: RoomImage[]; renderings: RoomImage[]; disableActions: boolean;
}) {
  const qc = useQueryClient();
  const done = sketchups.filter(s => renderings.some(r => r.linked_sketchup_id === s.id && r.status === "complete")).length;

  return (
    <section id={`room-${room.id}`} className="scroll-mt-24">
      <div className="flex items-end justify-between mb-5 border-b border-border pb-3 flex-wrap gap-3">
        <div>
          <div className="eyebrow">{done} of {sketchups.length} renderings complete</div>
          <h2 className="font-display text-3xl mt-1">{room.name}</h2>
        </div>
        <div className="flex items-center gap-3">
          <AddSketchupDialog roomId={room.id} projectId={projectId} />
          <AddExternalRenderingDialog roomId={room.id} projectId={projectId} sketchups={sketchups} renderings={renderings} />
          <Link to="/projects/$id/rooms/$roomId" params={{ id: projectId, roomId: room.id }} className="text-xs text-muted-foreground hover:text-ink underline">
            Open room
          </Link>
        </div>
      </div>

      {sketchups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">No SketchUp images yet for {room.name}. Add as many perspectives or elevations as you need.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sketchups.map(sk => (
            <SketchupCard
              key={sk.id}
              sk={sk}
              roomId={room.id}
              projectId={projectId}
              renderings={sortRenderings(renderings.filter(r => r.linked_sketchup_id === sk.id))}
              disableActions={disableActions}
              qc={qc}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ─────────── SketchUp + Renderings card ─────────── */
function SketchupCard({ sk, roomId, projectId, renderings, disableActions, qc }: {
  sk: RoomImage; roomId: string; projectId: string; renderings: RoomImage[]; disableActions: boolean; qc: ReturnType<typeof useQueryClient>;
}) {
  const status: RenderingStatus = sketchupStatus(sk.id, renderings);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy || disableActions) return;
    setBusy(true);
    await generateRendering(roomId, sk, qc, projectId);
    setBusy(false);
  };

  const removeSk = async () => {
    if (!confirm("Delete this SketchUp image and its renderings?")) return;
    for (const r of renderings) await db.deleteRoomImage(r.id);
    await db.deleteRoomImage(sk.id);
    qc.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
  };

  const cancelActiveJobs = async () => {
    const activeJobs = renderings.filter((rendering) => rendering.status === "queued" || rendering.status === "processing");
    if (!activeJobs.length) return;
    for (const job of activeJobs) {
      await db.deleteRoomImage(job.id);
    }
    qc.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
    toast.success(activeJobs.length === 1 ? "Rendering canceled" : "Renderings canceled");
  };

  return (
    <div className="border border-border p-3 flex flex-col">
      <div className="relative aspect-[4/3] bg-bone overflow-hidden mb-3">
        <img src={sk.url} alt={sk.caption || ""} className="w-full h-full object-cover" loading="lazy" />
        <StatusPill status={status} />
        <button onClick={removeSk} className="absolute top-2 right-2 bg-background/90 p-1.5 hover:bg-background">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {sk.caption && <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{sk.caption}</p>}

      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-[11px] text-muted-foreground">
          {renderings.filter(r => r.status === "complete").length} rendering{renderings.filter(r => r.status === "complete").length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          {(status === "processing" || status === "queued") && (
            <button
              disabled={disableActions}
              onClick={cancelActiveJobs}
              className={cn(
                "px-3 py-1.5 text-xs inline-flex items-center gap-1.5 border border-destructive text-destructive",
                disableActions ? "opacity-50 cursor-not-allowed" : "hover:bg-destructive hover:text-destructive-foreground",
              )}
            >
              <X className="w-3 h-3" />
              Stop
            </button>
          )}
          <button
            disabled={busy || disableActions || status === "processing" || status === "queued"}
            onClick={run}
            className={cn(
              "px-3 py-1.5 text-xs inline-flex items-center gap-1.5",
              (busy || disableActions || status === "processing" || status === "queued")
                ? "bg-bone text-muted-foreground"
                : "bg-ink text-primary-foreground hover:opacity-90"
            )}
          >
            {status === "complete" ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
            {busy ? "Generating…" : status === "complete" ? "Regenerate" : "Generate"}
          </button>
        </div>
      </div>

      {renderings.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border">
          {renderings.map(r => (
            <RenderingTile key={r.id} rendering={r} sketchup={sk} renderings={renderings} projectId={projectId} roomId={roomId} qc={qc} />
          ))}
        </div>
      )}
    </div>
  );
}

function RenderingTile({ rendering, sketchup, renderings, projectId, roomId, qc }: {
  rendering: RoomImage;
  sketchup: RoomImage;
  renderings: RoomImage[];
  projectId: string;
  roomId: string;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [open, setOpen] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [revisionReferenceUrl, setRevisionReferenceUrl] = useState("");
  const [revisionReferenceName, setRevisionReferenceName] = useState("");
  const [revising, setRevising] = useState(false);
  const version = rendering.revision_number || 1;
  const reviewStatus = rendering.review_status || (rendering.is_approved ? "approved" : "draft");

  const update = async (patch: Partial<RoomImage>) => {
    const projectImagesKey = ["projectRoomImages", projectId];
    const roomImagesKey = ["roomImages", roomId];
    const previousProjectImages = qc.getQueryData<RoomImage[]>(projectImagesKey);
    const previousRoomImages = qc.getQueryData<RoomImage[]>(roomImagesKey);
    const optimistic = { ...rendering, ...patch };
    const applyOptimistic = (current?: RoomImage[]) =>
      current?.map((img) => img.id === rendering.id ? optimistic : img) ?? current;

    qc.setQueryData<RoomImage[]>(projectImagesKey, applyOptimistic);
    qc.setQueryData<RoomImage[]>(roomImagesKey, applyOptimistic);

    try {
      const saved = await db.updateRoomImage(rendering.id, patch);
      if (saved) {
        const applySaved = (current?: RoomImage[]) =>
          current?.map((img) => img.id === rendering.id ? saved : img) ?? current;
        qc.setQueryData<RoomImage[]>(projectImagesKey, applySaved);
        qc.setQueryData<RoomImage[]>(roomImagesKey, applySaved);
      }
    } catch (error) {
      if (previousProjectImages) qc.setQueryData(projectImagesKey, previousProjectImages);
      if (previousRoomImages) qc.setQueryData(roomImagesKey, previousRoomImages);
      toast.error("Could not save rendering status");
      throw error;
    } finally {
      qc.invalidateQueries({ queryKey: projectImagesKey });
      qc.invalidateQueries({ queryKey: roomImagesKey });
    }
  };
  const remove = async () => {
    await db.deleteRoomImage(rendering.id);
    qc.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
  };
  const cancel = async () => {
    await db.deleteRoomImage(rendering.id);
    qc.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
    toast.success("Rendering canceled");
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = rendering.url;
    a.download = `rendering-${rendering.id}.png`;
    a.click();
  };
  const setReviewStatus = async (next: RenderingReviewStatus) => {
    await update({ review_status: next, is_approved: next === "approved" });
  };
  const createRevision = async () => {
    if (revising) return;
    const notes = revisionNotes.trim();
    if (!notes) return toast.error("Add the revision notes first");
    setRevising(true);
    try {
      await generateRendering(roomId, sketchup, qc, projectId, {
        baseRendering: rendering,
        revisionNotes: notes,
        revisionReferenceUrl,
        revisionNumber: nextRevisionNumber(renderings),
      });
      setRevisionNotes("");
      setRevisionReferenceUrl("");
      setRevisionReferenceName("");
      setOpen(false);
      toast.success("Revision started");
    } finally {
      setRevising(false);
    }
  };

  if (rendering.status !== "complete") {
    return (
      <div className="relative aspect-[4/3] bg-bone flex flex-col items-center justify-center gap-2 text-[10px] text-muted-foreground p-2 text-center">
        {(rendering.status === "queued" || rendering.status === "processing") && (
          <button
            type="button"
            title="Stop rendering"
            onClick={cancel}
            className="absolute top-1.5 right-1.5 bg-background/95 p-1.5 hover:bg-background"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        <span className="eyebrow text-[9px]">Version {version}</span>
        {rendering.status === "failed" ? (
          <span className="text-destructive">Failed: {rendering.error_message || "unknown"}</span>
        ) : (
          <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {rendering.status}</span>
        )}
      </div>
    );
  }

  return (
    <div className="group relative aspect-[4/3] bg-bone overflow-hidden">
      <img src={rendering.url} alt="" className="w-full h-full object-cover" loading="lazy" />
      <div className="absolute top-1 right-1 bg-background/90 text-[9px] uppercase tracking-wider px-1.5 py-0.5">
        V{version}
      </div>
      {rendering.is_favorite && (
        <div className="absolute top-1 left-1 bg-brass text-ink p-1"><Star className="w-2.5 h-2.5" fill="currentColor" /></div>
      )}
      {reviewStatus && (
        <div className="absolute bottom-1 left-1 right-1 text-[9px] uppercase tracking-wider bg-background/85 text-ink px-1.5 py-0.5 text-center truncate">
          {reviewLabel(reviewStatus)}
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        <div className="flex items-center gap-1">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <button title="View" className="bg-background/95 p-1.5"><Eye className="w-3 h-3" /></button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Rendering Version {version}</DialogTitle></DialogHeader>
              <img src={rendering.url} alt="" className="w-full" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div>
                  <Label className="eyebrow">Review Status</Label>
                  <Select value={reviewStatus} onValueChange={v => setReviewStatus(v as RenderingReviewStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="needs_revision">Needs Revision</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-3 text-xs">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rendering.is_approved}
                      onChange={e => update({ is_approved: e.target.checked, review_status: e.target.checked ? "approved" : "draft" })}
                    />
                    Approved
                  </label>
                </div>
              </div>
              {(rendering.revision_notes || rendering.revision_parent_id) && (
                <div className="border border-border bg-bone/40 p-3 text-sm">
                  <div className="eyebrow mb-1">Revision Notes</div>
                  <p className="text-muted-foreground whitespace-pre-wrap">{rendering.revision_notes || "Revision created from an earlier rendering."}</p>
                </div>
              )}
              <div className="border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  <div>
                    <div className="eyebrow">Create Revision</div>
                    <p className="text-xs text-muted-foreground">Keep this version, then generate a new one with only the correction notes below.</p>
                  </div>
                </div>
                <Textarea
                  value={revisionNotes}
                  onChange={e => setRevisionNotes(e.target.value)}
                  placeholder="Example: make the pendant scale slightly smaller, keep cabinetry and camera angle unchanged, warm up the wall color..."
                  rows={4}
                />
                <RevisionReferenceDropzone
                  imageUrl={revisionReferenceUrl}
                  fileName={revisionReferenceName}
                  onChange={(nextUrl, nextName) => {
                    setRevisionReferenceUrl(nextUrl);
                    setRevisionReferenceName(nextName);
                  }}
                />
                <button
                  type="button"
                  disabled={revising}
                  onClick={createRevision}
                  className="px-4 py-2 bg-ink text-primary-foreground text-sm disabled:opacity-50"
                >
                  {revising ? "Starting revision..." : "Create Revision"}
                </button>
              </div>
            </DialogContent>
          </Dialog>
          <button title="Revise" onClick={() => setOpen(true)} className="bg-background/95 p-1.5"><GitBranch className="w-3 h-3" /></button>
          <button title="Favorite" onClick={() => update({ is_favorite: !rendering.is_favorite })} className="bg-background/95 p-1.5">
            <Star className="w-3 h-3" fill={rendering.is_favorite ? "currentColor" : "none"} />
          </button>
          <button title="Download" onClick={download} className="bg-background/95 p-1.5"><Download className="w-3 h-3" /></button>
          <button title="Delete" onClick={remove} className="bg-background/95 p-1.5"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: RenderingStatus }) {
  const cfg: Record<RenderingStatus, { label: string; icon: any; cls: string }> = {
    not_generated: { label: "Not Generated", icon: Circle, cls: "bg-background/90 text-muted-foreground" },
    queued: { label: "Queued", icon: Clock, cls: "bg-background/90 text-ink" },
    processing: { label: "Processing", icon: Loader2, cls: "bg-background/90 text-ink" },
    complete: { label: "Complete", icon: CheckCircle2, cls: "bg-ink text-primary-foreground" },
    failed: { label: "Failed", icon: AlertCircle, cls: "bg-destructive text-destructive-foreground" },
  };
  const { label, icon: Icon, cls } = cfg[status];
  return (
    <div className={cn("absolute top-2 left-2 text-[10px] uppercase tracking-wider px-2 py-1 inline-flex items-center gap-1", cls)}>
      <Icon className={cn("w-2.5 h-2.5", status === "processing" && "animate-spin")} /> {label}
    </div>
  );
}

/* ─────────── Add SketchUp dialog ─────────── */
function AddSketchupDialog({ roomId, projectId }: { roomId: string; projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image too large (max 8MB)");
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      setUrl(dataUrl);
      setFileName(file.name || "sketchup-image");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!url.trim()) return toast.error("Upload an image or paste a URL");
    setSaving(true);
    try {
      const storedUrl = await persistRoomImageUrl(roomId, "sketchup", url, fileName || caption || "sketchup-image");
      const saved = await db.addRoomImage({ room_id: roomId, kind: "sketchup", url: storedUrl, caption });
      if (saved) {
        const insertImage = (current?: RoomImage[]) => {
          if (!current) return saved ? [saved] : current;
          return [...current, saved].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
        };
        qc.setQueryData<RoomImage[]>(["projectRoomImages", projectId], insertImage);
        qc.setQueryData<RoomImage[]>(["roomImages", roomId], insertImage);
      }
      qc.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
      qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
      setOpen(false); setUrl(""); setCaption(""); setFileName("");
      toast.success("SketchUp added");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-sm inline-flex items-center gap-1.5 px-3 py-1.5 border border-ink hover:bg-ink hover:text-primary-foreground transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add SketchUp
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Add SketchUp Image</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="eyebrow">Upload image</Label>
            <Input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} disabled={uploading || saving} />
            {url.startsWith("data:") && (
              <div className="mt-2 aspect-[4/3] bg-bone overflow-hidden">
                <img src={url} alt="preview" className="w-full h-full object-cover" />
              </div>
            )}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground text-center">or paste a URL</div>
          <div><Label className="eyebrow">Image URL</Label><Input value={url.startsWith("data:") ? "" : url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div>
          <div><Label className="eyebrow">Caption (e.g. Perspective 1, Vanity View)</Label><Input value={caption} onChange={e => setCaption(e.target.value)} /></div>
          <button onClick={submit} disabled={uploading || saving} className="w-full py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50">
            {uploading ? "Processing…" : saving ? "Saving…" : "Add"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddExternalRenderingDialog({
  roomId,
  projectId,
  sketchups,
  renderings,
}: {
  roomId: string;
  projectId: string;
  sketchups: RoomImage[];
  renderings: RoomImage[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [fileName, setFileName] = useState("");
  const [linkedSketchupId, setLinkedSketchupId] = useState<string>("none");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 12 * 1024 * 1024) return toast.error("Image too large (max 12MB)");
    setUploading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setUrl(dataUrl);
      setFileName(file.name || "rendering-image");
      if (!caption.trim()) {
        const baseName = file.name.replace(/\.[^.]+$/, "").trim();
        if (baseName) setCaption(baseName);
      }
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setOpen(false);
    setUrl("");
    setCaption("");
    setFileName("");
    setLinkedSketchupId("none");
  };

  const submit = async () => {
    if (!url.trim()) return toast.error("Upload a rendering or paste an image URL");
    setSaving(true);
    try {
      const linkedId = linkedSketchupId === "none" ? null : linkedSketchupId;
      const siblingVersions = linkedId
        ? renderings.filter((rendering) => rendering.linked_sketchup_id === linkedId)
        : [];
      const storedUrl = await persistRoomImageUrl(roomId, "rendering", url.trim(), fileName || caption || "rendering-image");
      await db.addRoomImage({
        room_id: roomId,
        kind: "rendering",
        url: storedUrl,
        caption: caption.trim() || "Uploaded rendering",
        linked_sketchup_id: linkedId,
        status: "complete",
        is_approved: true,
        review_status: "approved",
        revision_number: siblingVersions.length ? nextRevisionNumber(siblingVersions) : 1,
      });
      qc.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
      qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
      toast.success("Rendering added to this room and presentation flow");
      reset();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-sm inline-flex items-center gap-1.5 px-3 py-1.5 border border-ink hover:bg-ink hover:text-primary-foreground transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add External Rendering
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Add External AI Rendering</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="eyebrow">Upload rendering</Label>
            <Input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} disabled={uploading || saving} />
            {url.startsWith("data:") && (
              <div className="mt-2 aspect-[4/3] bg-bone overflow-hidden">
                <img src={url} alt="Rendering preview" className="w-full h-full object-cover" />
              </div>
            )}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground text-center">or paste a URL</div>
          <div>
            <Label className="eyebrow">Rendering URL</Label>
            <Input value={url.startsWith("data:") ? "" : url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label className="eyebrow">Caption</Label>
            <Input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Final hero view, Vanity rendering, Kitchen wide shot…" />
          </div>
          <div>
            <Label className="eyebrow">Link to SketchUp source</Label>
            <Select value={linkedSketchupId} onValueChange={setLinkedSketchupId}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No SketchUp source</SelectItem>
                {sketchups.map((sketchup, index) => (
                  <SelectItem key={sketchup.id} value={sketchup.id}>
                    {sketchup.caption?.trim() || `SketchUp ${index + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              This saves as a completed approved rendering so it can appear in presentations right away.
            </p>
          </div>
          <button onClick={submit} disabled={uploading || saving} className="w-full py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50">
            {uploading ? "Processing…" : saving ? "Saving…" : "Add Rendering"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Helpers ─────────── */
function sketchupStatus(skId: string, renderings: RoomImage[]): RenderingStatus {
  const linked = renderings.filter(r => r.linked_sketchup_id === skId);
  if (!linked.length) return "not_generated";
  // Prefer most recent (last in sort) — derive from highest priority
  if (linked.some(r => r.status === "processing")) return "processing";
  if (linked.some(r => r.status === "queued")) return "queued";
  if (linked.some(r => r.status === "complete")) return "complete";
  if (linked.every(r => r.status === "failed")) return "failed";
  return "not_generated";
}

function sortRenderings(renderings: RoomImage[]) {
  return [...renderings].sort((a, b) => {
    const versionDiff = (b.revision_number || 1) - (a.revision_number || 1);
    if (versionDiff !== 0) return versionDiff;
    return b.id.localeCompare(a.id);
  });
}

function nextRevisionNumber(renderings: RoomImage[]) {
  return Math.max(1, ...renderings.map(r => r.revision_number || 1)) + 1;
}

function reviewLabel(status: RenderingReviewStatus) {
  const labels: Record<RenderingReviewStatus, string> = {
    draft: "Draft",
    needs_revision: "Needs Revision",
    approved: "Approved",
    rejected: "Rejected",
  };
  return labels[status];
}

type GenerateOptions = {
  baseRendering?: RoomImage;
  revisionNotes?: string;
  revisionReferenceUrl?: string;
  revisionNumber?: number;
};

async function generateRendering(
  roomId: string,
  sk: RoomImage,
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
  options: GenerateOptions = {},
) {
  const isRevision = Boolean(options.baseRendering);
  try {
    // Build minimal context (room-level data) — fetch fresh
    const [room, selections, materials, project] = await Promise.all([
      db.getRoom(roomId),
      db.listRoomProducts(roomId),
      db.listMaterials(roomId),
      db.getProject(projectId),
    ]);
    const ctx = buildContext(room, project, selections ?? [], materials ?? []);
    const resolvedUrl = resolveImage(sk.url);
    let sketchupUrl = await compressImageSource(resolvedUrl || sk.url);
    if (sk.url?.startsWith("/src-assets/") && resolvedUrl) {
      const blob = await (await fetch(resolvedUrl)).blob();
      sketchupUrl = await fileToCompressedDataUrl(new File([blob], "sketchup-reference.png", { type: blob.type || "image/png" }));
    }
    const previousReferenceUrl = options.baseRendering?.url
      ? await compressImageSource(options.baseRendering.url)
      : undefined;
    const revisionReferenceUrl = options.revisionReferenceUrl
      ? await compressImageSource(options.revisionReferenceUrl)
      : undefined;
    const revisionContext = options.revisionNotes
      ? [
          "REVISION REQUEST",
          "Create a new version that corrects only the requested issues. Keep unchanged areas as close as possible to the previous rendering and the original SketchUp reference.",
          options.revisionNotes,
          options.revisionReferenceUrl ? "An additional uploaded reference image is included for the specific material, finish, tile, wallpaper, fabric, or detail described in the notes." : "",
        ].join("\n")
      : "";
    const extraContext = [sk.caption, ctx, revisionContext].filter(Boolean).join("\n\n");
    const res = await fetch("/api/generate-rendering", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "enqueue",
        roomId,
        sketchupId: sk.id,
        sketchupCaption: sk.caption,
        placeholderUrl: sk.url,
        sketchupUrl,
        referenceImageUrl: previousReferenceUrl,
        referenceImageUrls: revisionReferenceUrl ? [revisionReferenceUrl] : [],
        extraContext,
        revisionParentId: options.baseRendering?.id ?? null,
        revisionNumber: options.revisionNumber || 1,
        revisionNotes: options.revisionNotes || null,
      }),
    });
    if (!res.ok) {
      const message = res.headers.get("content-type")?.includes("application/json")
        ? ((await res.json()) as { error?: string }).error
        : await res.text();
      throw new Error(message || "Rendering generation failed");
    }
    const { placeholder } = (await res.json()) as { placeholder?: RoomImage };
    if (placeholder) {
      qc.setQueryData<RoomImage[]>(["projectRoomImages", projectId], (current = []) => [placeholder, ...current]);
      qc.setQueryData<RoomImage[]>(["roomImages", roomId], (current = []) => [placeholder, ...current]);
    }
  } catch (e: any) {
    toast.error(e?.message || "Generation failed");
  } finally {
    qc.invalidateQueries({ queryKey: ["projectRoomImages", projectId] });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
  }
}

function RevisionReferenceDropzone({ imageUrl, fileName, onChange }: {
  imageUrl: string;
  fileName: string;
  onChange: (imageUrl: string, fileName: string) => void;
}) {
  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please use an image file");
    if (file.size > 8 * 1024 * 1024) return toast.error("Reference image too large (max 8MB)");
    const dataUrl = await fileToCompressedDataUrl(file);
    onChange(dataUrl, file.name || "Reference image");
  };

  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        onFile(e.dataTransfer.files?.[0]);
      }}
      className="border border-dashed border-border bg-bone/30 p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="eyebrow">Optional Reference Image</Label>
          <p className="text-xs text-muted-foreground mt-1">Drop tile, wallpaper, fabric, or finish inspiration here.</p>
        </div>
        <Input className="max-w-[220px]" type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} />
      </div>
      {imageUrl && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-20 w-20 bg-background overflow-hidden border border-border">
            <img src={imageUrl} alt={fileName || "Revision reference"} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{fileName || "Reference image"}</p>
            <p className="text-xs text-muted-foreground">This will be sent with the revision request.</p>
          </div>
          <button type="button" onClick={() => onChange("", "")} className="text-xs underline text-muted-foreground hover:text-ink">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function buildContext(room: any, project: any, selections: RoomProduct[], materials: Material[]) {
  if (!room || !project) return "";
  const lines: string[] = ["PROJECT SELECTIONS", "", `Room: ${room.name}`, `Project: ${project.name}`];
  if (project.client_name) lines.push(`Client: ${project.client_name}`);
  lines.push("");
  if (materials.length) {
    lines.push("MATERIALS");
    for (const m of materials) {
      const bits = [`${m.category}: ${m.name}`];
      if (m.vendor) bits.push(`Vendor: ${m.vendor}`);
      if (m.sku) bits.push(`SKU: ${m.sku}`);
      if (m.notes) bits.push(`Notes: ${m.notes}`);
      lines.push("- " + bits.join(" | "));
    }
    lines.push("");
  }
  if (selections.length) {
    lines.push("PRODUCT SELECTIONS");
    for (const s of selections) {
      const p = s.product!;
      const bits = [p.name];
      if (p.subcategory) bits.push(`(${p.subcategory})`);
      if (p.vendor) bits.push(`Vendor: ${p.vendor}`);
      if (p.finish) bits.push(`Finish: ${p.finish}`);
      lines.push("- " + bits.join(" | "));
    }
    lines.push("");
  }
  if (room.design_concept) lines.push("DESIGN CONCEPT", room.design_concept, "");
  if (room.design_notes) lines.push("DESIGN NOTES", room.design_notes, "");
  if (project.design_concept) lines.push("PROJECT CONCEPT", project.design_concept, "");
  return lines.join("\n");
}
