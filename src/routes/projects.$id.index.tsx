import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ClipboardList, LayoutTemplate, Plus, DoorOpen, Trash2, Sparkles, Image as ImageIcon, X, DollarSign } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, PROJECT_STATUSES, WORKFLOW_STAGES, type ProjectStatus } from "@/lib/db";
import { StatusBadge } from "./index";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/$id/")({
  head: () => ({ meta: [{ title: "Project — MERAV Studio" }] }),
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => db.getProject(id) });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", id], queryFn: async () => (await db.listRooms(id)) ?? [] });
  const { data: allImages = [] } = useQuery({ queryKey: ["projectImages", id], queryFn: async () => (await db.listProjectRoomImages(id)) ?? [] });
  const { data: materialItems = [] } = useQuery({ queryKey: ["materialItems", id], queryFn: async () => (await db.listMaterialItemsByProject(id)) ?? [] });

  if (!project) {
    return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;
  }

  const hasSketchup = allImages.some(i => i.kind === "sketchup");
  const hasRendering = allImages.some(i => i.kind === "rendering");
  const hasSelections = materialItems.some(m => !!m.product_url || !!m.product_id);
  const hasSpecBook = materialItems.some(m => !!m.product_id);
  const approvedStatuses: ProjectStatus[] = ["Approved", "Procurement", "Complete"];
  const isApproved = approvedStatuses.includes(project.status);
  const inProcurement = project.status === "Procurement" || project.status === "Complete";

  const completed = [
    true,                  // Create Project
    rooms.length > 0,      // Create Rooms
    hasSketchup,
    hasSelections,
    hasRendering,
    hasRendering,          // Presentation Boards auto-built from renderings
    isApproved,
    hasSpecBook,
    inProcurement,
  ];

  const setStatus = async (s: ProjectStatus) => {
    await db.updateProject(id, { status: s });
    qc.invalidateQueries({ queryKey: ["project", id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-10 max-w-[1500px]">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-8">
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>

        <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">{project.project_type} · {project.client_name}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">{project.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <CoverImageDialog projectId={id} currentUrl={project.cover_image_url} allImages={allImages} />
            <Select value={project.status} onValueChange={v => setStatus(v as ProjectStatus)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Link to="/projects/$id/materials" params={{ id }} className="inline-flex items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors">
              <ClipboardList className="w-4 h-4" /> Materials
            </Link>
            <Link to="/projects/$id/renderings" params={{ id }} className="inline-flex items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors">
              <Sparkles className="w-4 h-4" /> Renderings
            </Link>
            <Link to="/projects/$id/financials" params={{ id }} className="inline-flex items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors">
              <DollarSign className="w-4 h-4" /> Financials
            </Link>
            <Link to="/projects/$id/presentation" params={{ id }} className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-primary-foreground text-sm">
              <LayoutTemplate className="w-4 h-4" /> Presentation
            </Link>

          </div>
        </div>

        {/* Workflow strip */}
        <WorkflowStrip completed={completed} />

        <div className="mt-14 mb-6 flex items-end justify-between">
          <div>
            <div className="eyebrow mb-2">Rooms</div>
            <h2 className="font-display text-3xl">Project rooms</h2>
            <p className="text-sm text-muted-foreground mt-1">Every selection, rendering, presentation, and spec is tied to a room.</p>
          </div>
          <AddRoomDialog projectId={id} />
        </div>

        {rooms.length === 0 ? (
          <div className="border border-dashed border-border py-20 text-center">
            <DoorOpen className="w-6 h-6 mx-auto text-muted-foreground mb-3" />
            <p className="font-display text-2xl">Start by adding the first room</p>
            <p className="text-sm text-muted-foreground mt-2">e.g. Kitchen, Pantry, Powder Bath, Primary Bath…</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rooms.map(r => <RoomCard key={r.id} room={r} projectId={id} />)}
          </div>
        )}

        {/* Project-level concept */}
        <div className="mt-20 pt-12 border-t border-border grid lg:grid-cols-3 gap-12">
          <div>
            <div className="eyebrow mb-2">Client</div>
            <p className="font-display text-2xl">{project.client_name}</p>
          </div>
          <div>
            <div className="eyebrow mb-2">Status</div>
            <StatusBadge status={project.status} />
          </div>
          <div>
            <div className="eyebrow mb-2">Design Notes</div>
            <p className="text-sm leading-relaxed">{project.design_notes || "—"}</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function WorkflowStrip({ completed }: { completed: boolean[] }) {
  return (
    <div className="border border-border bg-bone/40 p-6">
      <div className="eyebrow mb-4">Workflow</div>
      <ol className="flex flex-wrap gap-x-6 gap-y-3 text-[12px]">
        {WORKFLOW_STAGES.map((s, i) => {
          const done = completed[i];
          return (
            <li key={s} className="flex items-center gap-2">
              <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${done ? "bg-ink text-primary-foreground border-ink" : "border-border text-muted-foreground"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className={done ? "text-ink" : "text-muted-foreground"}>{s}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RoomCard({ room, projectId }: { room: { id: string; name: string }; projectId: string }) {
  const qc = useQueryClient();
  const { data: images = [] } = useQuery({ queryKey: ["roomImages", room.id], queryFn: async () => (await db.listRoomImages(room.id)) ?? [] });
  const { data: selections = [] } = useQuery({ queryKey: ["roomProducts", room.id], queryFn: async () => (await db.listRoomProducts(room.id)) ?? [] });

  const sketchups = images.filter(i => i.kind === "sketchup").length;
  const renderings = images.filter(i => i.kind === "rendering").length;
  const hero = images.find(i => i.kind === "rendering") || images.find(i => i.kind === "sketchup");

  const remove = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm(`Delete room "${room.name}"? This removes its selections, images, and specs.`)) return;
    await db.deleteRoom(room.id);
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    toast.success("Room deleted");
  };

  return (
    <Link to="/projects/$id/rooms/$roomId" params={{ id: projectId, roomId: room.id }} className="group block border border-border hover:border-ink transition-colors">
      <div className="aspect-[4/3] bg-bone overflow-hidden">
        {hero ? <img src={hero.url} alt={room.name} className="w-full h-full object-cover" loading="lazy" /> : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground font-display text-3xl">{room.name.charAt(0)}</div>
        )}
      </div>
      <div className="p-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl leading-tight truncate">{room.name}</h3>
          <p className="text-xs text-muted-foreground mt-2">
            {sketchups} SketchUp · {renderings} Renderings · {selections.length} Selections
          </p>
        </div>
        <button onClick={remove} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-ink transition-opacity">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </Link>
  );
}

function AddRoomDialog({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const submit = async () => {
    if (!name.trim()) return toast.error("Room name required");
    await db.createRoom({ project_id: projectId, name });
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    setOpen(false);
    setName("");
    toast.success("Room added");
  };

  const quickAdd = async (n: string) => {
    await db.createRoom({ project_id: projectId, name: n });
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    toast.success(`${n} added`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-primary-foreground text-sm">
          <Plus className="w-4 h-4" /> Add Room
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Add Room</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="eyebrow">Room Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Primary Bath" />
          </div>
          <button onClick={submit} className="w-full py-3 bg-ink text-primary-foreground text-sm">Add Room</button>
          <div className="pt-4 border-t border-border">
            <div className="eyebrow mb-2">Quick add</div>
            <div className="flex flex-wrap gap-2">
              {["Kitchen","Pantry","Powder Bath","Primary Bath","Primary Bedroom","Great Room","Mudroom","Office"].map(n => (
                <button key={n} onClick={() => quickAdd(n)} className="text-xs px-3 py-1.5 border border-border hover:border-ink">{n}</button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CoverImageDialog({ projectId, currentUrl, allImages }: { projectId: string; currentUrl: string | null; allImages: Array<{ id: string; url: string; kind: string; caption: string | null }> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  const save = async (url: string | null) => {
    await db.updateProject(projectId, { cover_image_url: url });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    setOpen(false);
    setUrlInput("");
    toast.success(url ? "Cover image set" : "Cover image cleared");
  };

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
      await save(dataUrl);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors">
          <ImageIcon className="w-4 h-4" /> Cover Image
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Set Cover Image</DialogTitle></DialogHeader>
        <div className="space-y-5">
          {currentUrl && (
            <div className="flex items-center gap-4">
              <div className="w-32 aspect-[4/3] bg-bone overflow-hidden border border-border">
                <img src={currentUrl} alt="current cover" className="w-full h-full object-cover" />
              </div>
              <button onClick={() => save(null)} className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-ink">
                <X className="w-3.5 h-3.5" /> Remove cover
              </button>
            </div>
          )}

          <div>
            <Label className="eyebrow">Upload image</Label>
            <Input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} disabled={uploading} />
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="eyebrow">Or paste image URL</Label>
              <Input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://…" />
            </div>
            <button onClick={() => urlInput.trim() && save(urlInput.trim())} className="px-4 py-2 bg-ink text-primary-foreground text-sm">Use URL</button>
          </div>

          {allImages.length > 0 && (
            <div>
              <div className="eyebrow mb-2">Or pick from project images</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-80 overflow-auto">
                {allImages.map(img => (
                  <button key={img.id} onClick={() => save(img.url)} className="group relative aspect-[4/3] bg-bone overflow-hidden border border-border hover:border-ink">
                    <img src={img.url} alt={img.caption ?? ""} className="w-full h-full object-cover" loading="lazy" />
                    <span className="absolute bottom-1 left-1 right-1 text-[10px] uppercase tracking-wider bg-ink/70 text-primary-foreground px-1.5 py-0.5 truncate">{img.kind}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewProjectQuickNote() {
  return null;
}

// Required to satisfy any tooling that imports field/textarea/etc. unused
void Textarea;
