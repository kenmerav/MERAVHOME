import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ClipboardList,
  LayoutTemplate,
  Plus,
  DoorOpen,
  Trash2,
  Sparkles,
  Image as ImageIcon,
  X,
  DollarSign,
  CheckCircle2,
  SlidersHorizontal,
  Pencil,
  FileText,
  Truck,
  Palette,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  db,
  PROJECT_LABELS,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type ProjectLabel,
  type Project,
  type ProjectStatus,
  type ProjectType,
  type ProjectTimeline,
} from "@/lib/db";
import { StatusBadge } from "./index";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { canViewFinancials, canViewProcurement } from "@/lib/permissions";
import { buildClientProductName } from "@/lib/clientProductName";
import { templateForRoomName } from "@/lib/roomTemplates";
import { printTimelineDraft, timelineFromRaw } from "@/components/TimelineCreator";

export const Route = createFileRoute("/projects/$id/")({
  head: () => ({ meta: [{ title: "Project — MERAV Studio" }] }),
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", id],
    queryFn: async () => (await db.listRooms(id)) ?? [],
  });
  const { data: allImages = [] } = useQuery({
    queryKey: ["projectImages", id],
    queryFn: async () => (await db.listProjectRoomImages(id)) ?? [],
  });
  const { data: timelines = [] } = useQuery({
    queryKey: ["projectTimelines", id],
    queryFn: async () => (await db.listProjectTimelines(id)) ?? [],
  });
  const { data: profile } = useQuery({
    queryKey: ["currentProfile"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return null;
      return (await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle()).data;
    },
  });

  if (!project) {
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  const isClientUser = profile?.role === "Client";

  const setStatus = async (s: ProjectStatus) => {
    await db.updateProject(id, { status: s });
    qc.invalidateQueries({ queryKey: ["project", id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const setProjectLabel = async (label: string) => {
    await db.updateProject(id, {
      project_label: label === "none" ? null : (label as ProjectLabel),
    });
    qc.invalidateQueries({ queryKey: ["project", id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-8"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>

        <div className="flex items-start lg:items-end justify-between mb-12 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">{project.client_name}</div>
            {isClientUser ? (
              <h1 className="editorial-hero text-5xl lg:text-7xl">{project.name}</h1>
            ) : (
              <EditableProjectName
                projectId={id}
                name={project.name}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["project", id] });
                  qc.invalidateQueries({ queryKey: ["projects"] });
                }}
              />
            )}
          </div>
          {!isClientUser && (
            <div className="flex w-full lg:w-auto flex-wrap items-center gap-3">
              <Select value={project.status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={project.project_label ?? "none"} onValueChange={setProjectLabel}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue placeholder="Project label" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No label</SelectItem>
                  {PROJECT_LABELS.map((label) => (
                    <SelectItem key={label} value={label}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ProjectInfoDialog
                project={project}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["project", id] });
                  qc.invalidateQueries({ queryKey: ["projects"] });
                }}
              />
              <CoverImageDialog
                projectId={id}
                currentUrl={project.cover_image_url}
                allImages={allImages}
              />
              <Link
                to="/projects/$id/design-boards"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <Palette className="w-4 h-4" /> Design Boards
              </Link>
              <Link
                to="/projects/$id/materials"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <ClipboardList className="w-4 h-4" /> Materials
              </Link>
              <Link
                to="/specbooks/$id"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <BookOpen className="w-4 h-4" /> Spec Book
              </Link>
              <Link
                to="/projects/$id/renderings"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <Sparkles className="w-4 h-4" /> Renderings
              </Link>
              <Link
                to="/projects/$id/approvals"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" /> Approval Setup
              </Link>
              <Link
                to="/client/approvals/$projectId"
                params={{ projectId: id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" /> Client View
              </Link>
              {canViewProcurement(profile) && (
                <a
                  href={`/procurement?project=${id}`}
                  className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
                >
                  <Truck className="w-4 h-4" /> Procurement
                </a>
              )}
              {canViewFinancials(profile) && (
                <Link
                  to="/projects/$id/financials"
                  params={{ id }}
                  className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
                >
                  <DollarSign className="w-4 h-4" /> Financials
                </Link>
              )}
              <Link
                to="/projects/$id/presentation"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 bg-ink text-primary-foreground text-sm"
              >
                <LayoutTemplate className="w-4 h-4" /> Presentation
              </Link>
              {profile?.is_owner && profile.role === "Admin" && (
                <DeleteProjectDialog
                  projectId={id}
                  projectName={project.name}
                  onDeleted={async () => {
                    qc.invalidateQueries({ queryKey: ["projects"] });
                    await navigate({ to: "/projects" });
                  }}
                />
              )}
            </div>
          )}
        </div>

        {timelines.length > 0 && (
          <section className="mb-12 border border-border bg-bone/20 p-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-5">
              <div>
                <div className="eyebrow mb-2">Timeline</div>
                <h2 className="font-display text-3xl">Project dates</h2>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {timelines.map((timeline) => (
                <TimelineCard key={timeline.id} timeline={timeline} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Rooms</div>
            <h2 className="font-display text-3xl">Project rooms</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Every selection, rendering, presentation, and spec is tied to a room.
            </p>
          </div>
          {!isClientUser && <AddRoomDialog projectId={id} />}
        </div>

        {rooms.length === 0 ? (
          <div className="border border-dashed border-border py-20 text-center">
            <DoorOpen className="w-6 h-6 mx-auto text-muted-foreground mb-3" />
            <p className="font-display text-2xl">Start by adding the first room</p>
            <p className="text-sm text-muted-foreground mt-2">
              e.g. Kitchen, Pantry, Powder Bath, Primary Bath…
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rooms.map((r) => (
              <RoomCard key={r.id} room={r} projectId={id} canDelete={!isClientUser} />
            ))}
          </div>
        )}

        {/* Project-level concept */}
        <div className="mt-20 pt-12 border-t border-border grid md:grid-cols-2 lg:grid-cols-4 gap-12">
          <div>
            <div className="eyebrow mb-2">Client</div>
            <p className="font-display text-2xl">{project.client_name}</p>
          </div>
          <div>
            <div className="eyebrow mb-2">Status</div>
            <StatusBadge status={project.status} />
          </div>
          <div>
            <div className="eyebrow mb-2">Project Label</div>
            <p className="font-display text-2xl">{project.project_label || "Unlabeled"}</p>
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

function EditableProjectName({
  projectId,
  name,
  onSaved,
}: {
  projectId: string;
  name: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    setValue(name);
    setEditing(false);
  };

  const saveName = async () => {
    const nextName = value.trim();
    if (!nextName) {
      toast.error("Project name cannot be blank.");
      setValue(name);
      return;
    }
    if (nextName === name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await db.updateProject(projectId, { name: nextName });
      toast.success("Project name updated");
      setEditing(false);
      onSaved();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Unable to update project name."));
      setValue(name);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        aria-label="Project name"
        autoFocus
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={saveName}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="block w-full bg-transparent border-0 border-b border-ink px-0 py-1 font-display text-5xl lg:text-7xl leading-none text-ink outline-none disabled:opacity-60"
      />
    );
  }

  return (
    <button
      type="button"
      title="Edit project name"
      onClick={() => setEditing(true)}
      className="block max-w-full text-left editorial-hero text-5xl lg:text-7xl transition-colors hover:text-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
    >
      {name}
    </button>
  );
}

function TimelineCard({ timeline }: { timeline: ProjectTimeline }) {
  const draft = timelineFromRaw(timeline.raw_text);
  const milestones = draft?.milestones ?? [];

  const openSavedTimeline = () => {
    if (!timeline.html_data_url) return;
    window.open(timeline.html_data_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="border border-border bg-background p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">{timeline.timeline_date || "Timeline"}</div>
          <h3 className="font-display text-2xl leading-tight">
            {timeline.title || "Service Timeline"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {timeline.project_name || timeline.client_name || "Project"}
          </p>
        </div>
        <CalendarDays className="w-5 h-5 text-muted-foreground" />
      </div>

      {milestones.length > 0 && (
        <div className="mt-5 divide-y divide-border">
          {milestones.slice(0, 5).map((milestone, index) => (
            <div
              key={`${milestone.weekLabel}-${index}`}
              className="py-3 grid grid-cols-[110px_1fr] gap-4 text-sm"
            >
              <div className="font-medium">{milestone.weekLabel || `Week ${index + 1}`}</div>
              <div>
                <div className="line-clamp-2">{milestone.description}</div>
                {milestone.estimatedDate && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatTimelineDate(milestone.estimatedDate)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {draft && (
          <button
            type="button"
            onClick={() => printTimelineDraft(draft)}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border text-sm hover:border-ink"
          >
            <FileText className="w-4 h-4" /> Download PDF
          </button>
        )}
        {timeline.html_data_url && (
          <button
            type="button"
            onClick={openSavedTimeline}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border text-sm hover:border-ink"
          >
            Open Timeline
          </button>
        )}
      </div>
    </div>
  );
}

function formatTimelineDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ProjectInfoDialog({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    client_name: project.client_name,
    project_type: project.project_type,
    status: project.status,
    project_label: project.project_label ?? "none",
    design_notes: project.design_notes ?? "",
  });

  const resetForm = () => {
    setForm({
      client_name: project.client_name,
      project_type: project.project_type,
      status: project.status,
      project_label: project.project_label ?? "none",
      design_notes: project.design_notes ?? "",
    });
  };

  const save = async () => {
    const clientName = form.client_name.trim();
    if (!clientName) {
      toast.error("Client name cannot be blank.");
      return;
    }

    setSaving(true);
    try {
      await db.updateProject(project.id, {
        client_name: clientName,
        project_type: form.project_type as ProjectType,
        status: form.status as ProjectStatus,
        project_label: form.project_label === "none" ? null : (form.project_label as ProjectLabel),
        design_notes: form.design_notes.trim() || null,
      });
      toast.success("Project info updated");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Unable to update project info."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <button className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors">
          <Pencil className="w-4 h-4" /> Project Info
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">Edit Project Info</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="eyebrow">Client Name</Label>
              <Input
                value={form.client_name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, client_name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label className="eyebrow">Project Type</Label>
              <Select
                value={form.project_type}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, project_type: value as ProjectType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="eyebrow">Status</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, status: value as ProjectStatus }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="eyebrow">Project Label</Label>
              <Select
                value={form.project_label}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, project_label: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No label</SelectItem>
                  {PROJECT_LABELS.map((label) => (
                    <SelectItem key={label} value={label}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="eyebrow">Design Notes</Label>
            <Textarea
              value={form.design_notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, design_notes: event.target.value }))
              }
              rows={5}
              placeholder="Project notes, client preferences, scope notes..."
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-5 py-2.5 border border-border text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-5 py-2.5 bg-ink text-primary-foreground text-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Project Info"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectDialog({
  projectId,
  projectName,
  onDeleted,
}: {
  projectId: string;
  projectName: string;
  onDeleted: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const canDelete = confirmName.trim() === projectName;

  const deleteProject = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ project_id: projectId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Unable to delete project.");
      toast.success("Project deleted");
      setOpen(false);
      await onDeleted();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Unable to delete project."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmName("");
      }}
    >
      <AlertDialogTrigger asChild>
        <button className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-destructive/40 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground transition-colors">
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl font-normal">
            Delete this project?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the project, rooms, renderings, material checklist, selections,
            procurement links, and financial invoices. The global product catalog will stay intact.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <Label className="eyebrow">Type project name to confirm</Label>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={projectName}
          />
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-5 py-2.5 border border-border text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={deleteProject}
            disabled={!canDelete || deleting}
            className="px-5 py-2.5 bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete project"}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RoomCard({
  room,
  projectId,
  canDelete,
}: {
  room: { id: string; name: string };
  projectId: string;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const { data: images = [] } = useQuery({
    queryKey: ["roomImages", room.id],
    queryFn: async () => (await db.listRoomImages(room.id)) ?? [],
  });
  const { data: selections = [] } = useQuery({
    queryKey: ["roomProducts", room.id],
    queryFn: async () => (await db.listRoomProducts(room.id)) ?? [],
  });

  const sketchups = images.filter((i) => i.kind === "sketchup").length;
  const renderings = images.filter((i) => i.kind === "rendering").length;
  const hero =
    images.find((i) => i.kind === "rendering") || images.find((i) => i.kind === "sketchup");

  const remove = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm(`Delete room "${room.name}"? This removes its selections, images, and specs.`))
      return;
    await db.deleteRoom(room.id);
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    toast.success("Room deleted");
  };

  const rename = async (nextName: string) => {
    const name = nextName.trim();
    if (!name) return toast.error("Room name required.");
    if (name === room.name) return;

    await db.updateRoom(room.id, { name });
    const materialItems = ((await db.listMaterialItemsByProject(projectId)) ?? []).filter(
      (item) => item.room_id === room.id,
    );
    await Promise.all(
      materialItems.map((item) =>
        db.updateMaterialItem(item.id, {
          client_product_name: buildClientProductName(name, item.item_label),
        }),
      ),
    );
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    qc.invalidateQueries({ queryKey: ["room", room.id] });
    qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
    toast.success(`Renamed room to ${name}`);
  };

  return (
    <Link
      to="/projects/$id/rooms/$roomId"
      params={{ id: projectId, roomId: room.id }}
      className="group block border border-border hover:border-ink transition-colors"
    >
      <div className="aspect-[4/3] bg-bone overflow-hidden">
        {hero ? (
          <img
            src={hero.url}
            alt={room.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground font-display text-3xl">
            {room.name.charAt(0)}
          </div>
        )}
      </div>
      <div className="p-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl leading-tight truncate">{room.name}</h3>
          <p className="text-xs text-muted-foreground mt-2">
            {sketchups} SketchUp · {renderings} Renderings · {selections.length} Selections
          </p>
        </div>
        {canDelete && (
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <EditRoomNameDialog currentName={room.name} onSave={rename} />
            <button onClick={remove} className="text-muted-foreground hover:text-ink">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </Link>
  );
}

function EditRoomNameDialog({
  currentName,
  onSave,
}: {
  currentName: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(name);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setName(currentName);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="text-muted-foreground hover:text-ink"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Edit Room Name</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="eyebrow">Room Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Kitchen"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            This will also update this room's client product names.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="w-full py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Room Name"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddRoomDialog({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const createRoomWithMaterials = async (roomName: string) => {
    const trimmedName = roomName.trim();
    if (!trimmedName) throw new Error("Room name required");
    const room = await db.createRoom({ project_id: projectId, name: trimmedName });
    if (!room) throw new Error("Could not create room");

    const template = templateForRoomName(trimmedName);
    if (template.length > 0) {
      await db.bulkInsertMaterialItems(
        template.map((item, index) => ({
          room_id: room.id,
          project_id: projectId,
          item_label: item.label,
          client_product_name: buildClientProductName(trimmedName, item.label),
          category: item.category,
          is_required: true,
          sort_order: index,
          cad_label: null,
          product_url: null,
          quantity: null,
          color: null,
          notes: null,
          not_needed: false,
          product_id: null,
          scrape_status: "pending",
          scrape_error: null,
        })),
      );
    }

    return room;
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Room name required");
    await createRoomWithMaterials(name);
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
    setOpen(false);
    setName("");
    toast.success("Room added");
  };

  const quickAdd = async (n: string) => {
    await createRoomWithMaterials(n);
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
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
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Add Room</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="eyebrow">Room Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Primary Bath"
            />
          </div>
          <button onClick={submit} className="w-full py-3 bg-ink text-primary-foreground text-sm">
            Add Room
          </button>
          <div className="pt-4 border-t border-border">
            <div className="eyebrow mb-2">Quick add</div>
            <div className="flex flex-wrap gap-2">
              {[
                "Kitchen",
                "Pantry",
                "Powder Bath",
                "Primary Bath",
                "Primary Bedroom",
                "Great Room",
                "Mudroom",
                "Office",
              ].map((n) => (
                <button
                  key={n}
                  onClick={() => quickAdd(n)}
                  className="text-xs px-3 py-1.5 border border-border hover:border-ink"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CoverImageDialog({
  projectId,
  currentUrl,
  allImages,
}: {
  projectId: string;
  currentUrl: string | null;
  allImages: Array<{ id: string; url: string; kind: string; caption: string | null }>;
}) {
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
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Set Cover Image</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {currentUrl && (
            <div className="flex items-center gap-4">
              <div className="w-32 aspect-[4/3] bg-bone overflow-hidden border border-border">
                <img src={currentUrl} alt="current cover" className="w-full h-full object-cover" />
              </div>
              <button
                onClick={() => save(null)}
                className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-ink"
              >
                <X className="w-3.5 h-3.5" /> Remove cover
              </button>
            </div>
          )}

          <div>
            <Label className="eyebrow">Upload image</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0])}
              disabled={uploading}
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="eyebrow">Or paste image URL</Label>
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <button
              onClick={() => urlInput.trim() && save(urlInput.trim())}
              className="px-4 py-2 bg-ink text-primary-foreground text-sm"
            >
              Use URL
            </button>
          </div>

          {allImages.length > 0 && (
            <div>
              <div className="eyebrow mb-2">Or pick from project images</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-80 overflow-auto">
                {allImages.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => save(img.url)}
                    className="group relative aspect-[4/3] bg-bone overflow-hidden border border-border hover:border-ink"
                  >
                    <img
                      src={img.url}
                      alt={img.caption ?? ""}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute bottom-1 left-1 right-1 text-[10px] uppercase tracking-wider bg-ink/70 text-primary-foreground px-1.5 py-0.5 truncate">
                      {img.kind}
                    </span>
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
