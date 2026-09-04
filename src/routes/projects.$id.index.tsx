import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  ShieldCheck,
  type LucideIcon,
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
  type Room,
  type RoomImage,
  type MaterialItem,
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
import {
  canManageStudio,
  canViewFinancials,
  canViewProcurement,
  canViewProjectSurface,
  isClientRole,
  isContractorRole,
  isSharedProjectRole,
} from "@/lib/permissions";
import { buildClientProductName } from "@/lib/clientProductName";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { templateForRoomName } from "@/lib/roomTemplates";
import { printTimelineDraft, timelineFromRaw } from "@/components/TimelineCreator";
import { ProjectManagementSummary } from "@/components/ProjectManagementSummary";

export const Route = createFileRoute("/projects/$id/")({
  head: () => ({ meta: [{ title: "Project — MERAV Studio" }] }),
  component: ProjectDetailPage,
});

const DESIGN_BOARD_ROOM_COVER_PREFIX = "design-board-page:";
const DESIGN_BOARD_PREVIEW_WIDTH = 1400;
const DESIGN_BOARD_PREVIEW_HEIGHT = 900;

type RoomCoverBoardElement = {
  id: string;
  type: "image" | "text" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation?: number;
  visible?: boolean;
  src?: string;
  backgroundRemovedUrl?: string;
  text?: string;
  background?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  letterSpacing?: number;
};

type RoomCoverBoardPage = {
  id: string;
  title: string;
  roomId: string | null;
  hidden?: boolean;
  roomApprovalStatus?: "approved" | "declined";
  declinedMaterialItems?: DeclinedBoardMaterialItem[];
  elements: RoomCoverBoardElement[];
};

type DeclinedBoardMaterialItem = Omit<
  MaterialItem,
  "id" | "created_at" | "updated_at" | "product" | "room_product"
>;

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
  const { data: designBoard } = useQuery({
    queryKey: ["designBoard", id],
    queryFn: () => db.getDesignBoard(id),
  });
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["currentProfile"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return null;
      return (await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle()).data;
    },
  });
  const isSharedUser = isSharedProjectRole(profile?.role);

  useEffect(() => {
    if (profileLoading || isSharedUser) return;
    db.markProjectOpened(id)
      .then(() => qc.invalidateQueries({ queryKey: ["projects"] }))
      .catch(() => undefined);
  }, [id, isSharedUser, profileLoading, qc]);

  if (!project || profileLoading) {
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  const designBoardPages = normalizeRoomCoverBoardPages(designBoard?.board_state);

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
            {isSharedUser ? (
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
          {!isSharedUser && (
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
              {project.design_workflow_version === "room_design_v2" &&
                canManageStudio(profile) &&
                rooms[0] && (
                  <Link
                    to="/projects/$id/room-design"
                    params={{ id }}
                    search={{ roomId: rooms[0].id, manualBoard: undefined, stage: undefined }}
                    className="inline-flex flex-1 items-center justify-center gap-2 bg-ink px-4 py-2.5 text-sm text-primary-foreground transition-colors hover:bg-ink/90 sm:flex-none"
                  >
                    <LayoutTemplate className="h-4 w-4" /> Room Design
                  </Link>
                )}
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
                to="/projects/$id/construction-docs"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <FileText className="w-4 h-4" /> Construction Docs
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
                to="/projects/$id/rendering-studio"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <ImageIcon className="w-4 h-4" /> Rendering Studio
              </Link>
              <Link
                to="/projects/$id/approvals"
                params={{ id }}
                className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" /> Approval Setup
              </Link>
              {canManageStudio(profile) && (
                <ProjectAccessDialog
                  project={project}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ["project", id] });
                    qc.invalidateQueries({ queryKey: ["projects"] });
                  }}
                />
              )}
              {canViewFinancials(profile) && (
                <ProjectTodoDialog projectId={id} />
              )}
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
              {canManageStudio(profile) && (
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

        {!isSharedUser && <ProjectManagementSummary projectId={id} />}

        {isSharedUser && (
          <SharedProjectPortal project={project} projectId={id} profile={profile} />
        )}

        {!isSharedUser && (
          <>
            <div className="mt-8 mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <div className="eyebrow mb-2">Rooms</div>
                <h2 className="font-display text-3xl">Project rooms</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Every selection, rendering, presentation, and spec is tied to a room.
                </p>
              </div>
              <AddRoomDialog projectId={id} />
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
                  <RoomCard
                    key={r.id}
                    room={r}
                    projectId={id}
                    canDelete
                    boardPages={designBoardPages}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!isSharedUser && (
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
        )}
      </div>
    </AppShell>
  );
}

function SharedProjectPortal({
  project,
  projectId,
  profile,
}: {
  project: Project;
  projectId: string;
  profile: { role: "Client" | "Contractor"; is_active: boolean } | null | undefined;
}) {
  const links = [
    isClientRole(profile?.role) && project.approval_live
      ? {
          label: "Approvals",
          description: "Review selections, approve items, request changes, and leave comments.",
          href: `/client/approvals/${projectId}`,
          icon: CheckCircle2,
        }
      : null,
    isClientRole(profile?.role)
      ? {
          label: "Invoices",
          description: "View shared invoices, payment status, and download invoice PDFs.",
          href: `/client/financials?project=${projectId}`,
          icon: DollarSign,
        }
      : null,
    canViewProjectSurface(profile, project, "constructionDocs")
      ? {
          label: "Construction Docs",
          description: "Open layout docs, SketchUp references, renderings, and construction files.",
          href: `/projects/${projectId}/construction-docs`,
          icon: FileText,
        }
      : null,
    canViewProjectSurface(profile, project, "specBook")
      ? {
          label: "Spec Book",
          description: "View the current approved project specifications.",
          href: `/specbooks/${projectId}`,
          icon: BookOpen,
        }
      : null,
    canViewProjectSurface(profile, project, "presentations")
      ? {
          label: "Presentation",
          description: "Open the presentation boards shared for this project.",
          href: `/presentations/${projectId}`,
          icon: LayoutTemplate,
        }
      : null,
    canViewProjectSurface(profile, project, "designBoards")
      ? {
          label: "Design Boards",
          description: "View the design boards shared by the studio team.",
          href: `/projects/${projectId}/design-boards`,
          icon: Palette,
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    description: string;
    href: string;
    icon: LucideIcon;
  }>;

  return (
    <section className="mt-8 border border-border bg-bone/20 p-6 lg:p-8">
      <div className="eyebrow mb-2">Project Portal</div>
      <h2 className="font-display text-3xl">Shared project items</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        The studio will turn each section on when it is ready for you.
      </p>
      {links.length === 0 ? (
        <div className="mt-8 border border-dashed border-border bg-white p-8 text-sm text-muted-foreground">
          Nothing has been shared yet. Once approvals, presentations, or the spec book are ready,
          they will appear here.
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {links.map(({ label, description, href, icon: Icon }) => (
            <a
              key={label}
              href={href}
              className="group border border-border bg-white p-5 transition-colors hover:border-ink hover:bg-bone/40"
            >
              <Icon className="h-5 w-5 text-muted-foreground group-hover:text-ink" />
              <h3 className="mt-5 font-display text-2xl">{label}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

type ProjectTodoAssignee = {
  id: string;
  email: string;
  full_name: string;
  role: string;
};

type ProjectTodo = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  reminder_date: string | null;
  status: string;
  assigned_user?: ProjectTodoAssignee | null;
};

function ProjectTodoDialog({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["projectTodos", projectId],
    enabled: open,
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`/api/project-todos?projectId=${encodeURIComponent(projectId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load project to-dos.");
      return body as { todos: ProjectTodo[]; assignees: ProjectTodoAssignee[]; setupNeeded?: boolean };
    },
  });

  const assignees = data?.assignees ?? [];
  const openTodos = (data?.todos ?? []).filter((todo) => todo.status !== "complete");

  const createTodo = async () => {
    if (!title.trim()) return toast.error("Add a to-do title.");
    if (!assignedUserId) return toast.error("Choose who this is for.");
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/project-todos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          project_id: projectId,
          assigned_user_id: assignedUserId,
          title,
          due_date: dueDate || null,
          reminder_date: reminderDate || null,
          priority,
          notes,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not add to-do.");
      toast.success("To-do assigned");
      setTitle("");
      setAssignedUserId("");
      setDueDate("");
      setReminderDate("");
      setPriority("normal");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["projectTodos", projectId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add to-do.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
        >
          <ClipboardList className="w-4 h-4" /> Assign To-Do
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="eyebrow mb-2">Shared Follow-Up</div>
          <DialogTitle className="font-display text-3xl">Assign a Project To-Do</DialogTitle>
        </DialogHeader>
        {data?.setupNeeded ? (
          <div className="border border-dashed border-border bg-bone/30 p-4 text-sm text-muted-foreground">
            Project to-do storage needs the Supabase migration before this can save.
          </div>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label className="eyebrow">To-Do</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Confirm outlet layout before rough-in" />
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Assigned To</Label>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">{isLoading ? "Loading..." : "Choose client / GC"}</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {(assignee.full_name || assignee.email) + (assignee.role === "Contractor" ? " - GC/Builder" : " - Client")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Priority</Label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="h-10 w-full border border-input bg-background px-3 text-sm">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Reminder Date</Label>
            <Input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label className="eyebrow">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Add any context they need." />
          </div>
        </div>
        <button
          type="button"
          onClick={createTodo}
          disabled={busy || data?.setupNeeded}
          className="inline-flex items-center justify-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {busy ? "Adding..." : "Add To-Do"}
        </button>
        <div className="border-t border-border pt-4">
          <div className="eyebrow mb-3">Open Shared To-Dos</div>
          {openTodos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open shared to-dos for this project.</p>
          ) : (
            <div className="space-y-2">
              {openTodos.slice(0, 6).map((todo) => (
                <div key={todo.id} className="border border-border bg-bone/20 p-3 text-sm">
                  <div className="font-medium">{todo.title}</div>
                  <div className="mt-1 text-muted-foreground">
                    {todo.assigned_user?.full_name || todo.assigned_user?.email || "Assigned user"}
                    {todo.due_date ? ` - Due ${formatDate(todo.due_date)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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

function ProjectAccessDialog({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    client_can_view_spec_book: project.client_can_view_spec_book,
    client_can_view_presentations: project.client_can_view_presentations,
    client_can_view_design_boards: project.client_can_view_design_boards,
    client_can_download_design_board_pdf:
      project.client_can_download_design_board_pdf ?? false,
    client_can_view_construction_docs: project.client_can_view_construction_docs,
    client_can_download_construction_docs:
      project.client_can_download_construction_docs ?? false,
    client_can_download_spec_book_pdf: project.client_can_download_spec_book_pdf ?? false,
    client_spec_show_pricing: project.client_spec_show_pricing,
    client_spec_show_links: project.client_spec_show_links,
    client_spec_show_ordering: project.client_spec_show_ordering ?? false,
    contractor_can_view_spec_book: project.contractor_can_view_spec_book,
    contractor_can_view_presentations: project.contractor_can_view_presentations,
    contractor_can_view_design_boards: project.contractor_can_view_design_boards,
    contractor_can_download_design_board_pdf:
      project.contractor_can_download_design_board_pdf ?? false,
    contractor_can_view_construction_docs: project.contractor_can_view_construction_docs,
    contractor_can_download_spec_book_pdf: project.contractor_can_download_spec_book_pdf ?? false,
    contractor_spec_show_pricing: project.contractor_spec_show_pricing,
    contractor_spec_show_links: project.contractor_spec_show_links,
    contractor_spec_show_ordering: project.contractor_spec_show_ordering ?? true,
    contractor_spec_can_update_ordering: project.contractor_spec_can_update_ordering ?? false,
  });

  const resetForm = () => {
    setForm({
      client_can_view_spec_book: project.client_can_view_spec_book,
      client_can_view_presentations: project.client_can_view_presentations,
      client_can_view_design_boards: project.client_can_view_design_boards,
      client_can_download_design_board_pdf:
        project.client_can_download_design_board_pdf ?? false,
      client_can_view_construction_docs: project.client_can_view_construction_docs,
      client_can_download_construction_docs:
        project.client_can_download_construction_docs ?? false,
      client_can_download_spec_book_pdf: project.client_can_download_spec_book_pdf ?? false,
      client_spec_show_pricing: project.client_spec_show_pricing,
      client_spec_show_links: project.client_spec_show_links,
      client_spec_show_ordering: project.client_spec_show_ordering ?? false,
      contractor_can_view_spec_book: project.contractor_can_view_spec_book,
      contractor_can_view_presentations: project.contractor_can_view_presentations,
      contractor_can_view_design_boards: project.contractor_can_view_design_boards,
      contractor_can_download_design_board_pdf:
        project.contractor_can_download_design_board_pdf ?? false,
      contractor_can_view_construction_docs: project.contractor_can_view_construction_docs,
      contractor_can_download_spec_book_pdf: project.contractor_can_download_spec_book_pdf ?? false,
      contractor_spec_show_pricing: project.contractor_spec_show_pricing,
      contractor_spec_show_links: project.contractor_spec_show_links,
      contractor_spec_show_ordering: project.contractor_spec_show_ordering ?? true,
      contractor_spec_can_update_ordering: project.contractor_spec_can_update_ordering ?? false,
    });
  };

  const toggle = (key: keyof typeof form) => {
    setForm((current) => ({ ...current, [key]: !current[key] }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await db.updateProject(project.id, form);
      toast.success("Project access updated");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Unable to update project access."));
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
          <ShieldCheck className="w-4 h-4" /> Access
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">Project Access</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-2">
          <AccessRolePanel
            title="Client"
            description="Control what the client can open and what details they see in the spec book."
            rows={[
              ["Spec Book Ready", form.client_can_view_spec_book, () => toggle("client_can_view_spec_book")],
              ["Presentations Ready", form.client_can_view_presentations, () => toggle("client_can_view_presentations")],
              ["Design Boards Ready", form.client_can_view_design_boards, () => toggle("client_can_view_design_boards")],
              ["Can Download Design Board PDF", form.client_can_download_design_board_pdf, () => toggle("client_can_download_design_board_pdf")],
              ["Construction Docs Ready", form.client_can_view_construction_docs, () => toggle("client_can_view_construction_docs")],
              ["Can Download Construction Docs", form.client_can_download_construction_docs, () => toggle("client_can_download_construction_docs")],
              ["Can Download Spec Book PDF", form.client_can_download_spec_book_pdf, () => toggle("client_can_download_spec_book_pdf")],
              ["Spec Shows Pricing", form.client_spec_show_pricing, () => toggle("client_spec_show_pricing")],
              ["Spec Shows Product Links", form.client_spec_show_links, () => toggle("client_spec_show_links")],
              ["Spec Shows Ordering", form.client_spec_show_ordering, () => toggle("client_spec_show_ordering")],
            ]}
          />
          <AccessRolePanel
            title="Builder / GC"
            description="Control when the builder can access project documents and whether the full spec is visible."
            rows={[
              ["Spec Book Ready", form.contractor_can_view_spec_book, () => toggle("contractor_can_view_spec_book")],
              ["Presentations Ready", form.contractor_can_view_presentations, () => toggle("contractor_can_view_presentations")],
              ["Design Boards Ready", form.contractor_can_view_design_boards, () => toggle("contractor_can_view_design_boards")],
              ["Can Download Design Board PDF", form.contractor_can_download_design_board_pdf, () => toggle("contractor_can_download_design_board_pdf")],
              ["Construction Docs Ready", form.contractor_can_view_construction_docs, () => toggle("contractor_can_view_construction_docs")],
              ["Can Download Spec Book PDF", form.contractor_can_download_spec_book_pdf, () => toggle("contractor_can_download_spec_book_pdf")],
              ["Spec Shows Pricing", form.contractor_spec_show_pricing, () => toggle("contractor_spec_show_pricing")],
              ["Spec Shows Product Links", form.contractor_spec_show_links, () => toggle("contractor_spec_show_links")],
              ["Spec Shows Ordering", form.contractor_spec_show_ordering, () => toggle("contractor_spec_show_ordering")],
              ["Can Update Ordering", form.contractor_spec_can_update_ordering, () => toggle("contractor_spec_can_update_ordering")],
            ]}
          />
        </div>
        <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col-reverse gap-3 border-t border-border bg-background px-6 py-4 sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:justify-end sm:border-0 sm:p-0">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full border border-border px-5 py-2.5 text-sm sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="w-full bg-ink px-5 py-2.5 text-sm text-primary-foreground disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Saving..." : "Save Access"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccessRolePanel({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: [string, boolean, () => void][];
}) {
  return (
    <div className="border border-border p-5">
      <h3 className="font-display text-2xl">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-5 divide-y divide-border">
        {rows.map(([label, checked, onChange]) => (
          <label key={label} className="flex cursor-pointer items-center justify-between gap-4 py-3 text-sm">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={checked}
              onChange={onChange}
              className="h-5 w-5 accent-ink"
            />
          </label>
        ))}
      </div>
    </div>
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

function normalizeRoomCoverBoardElement(value: unknown): RoomCoverBoardElement | null {
  if (!value || typeof value !== "object") return null;
  const element = value as Partial<RoomCoverBoardElement>;
  if (element.type !== "image" && element.type !== "text" && element.type !== "shape") return null;
  return {
    ...element,
    id: typeof element.id === "string" && element.id ? element.id : crypto.randomUUID(),
    type: element.type,
    x: typeof element.x === "number" ? element.x : 0,
    y: typeof element.y === "number" ? element.y : 0,
    width: typeof element.width === "number" ? element.width : 240,
    height: typeof element.height === "number" ? element.height : 180,
    zIndex: typeof element.zIndex === "number" ? element.zIndex : 0,
    rotation: typeof element.rotation === "number" ? element.rotation : 0,
    visible: element.visible === false ? false : true,
  };
}

function normalizeRoomCoverBoardPages(boardState: unknown): RoomCoverBoardPage[] {
  if (!boardState || typeof boardState !== "object") return [];
  const candidate = boardState as { pages?: unknown[] };
  if (!Array.isArray(candidate.pages)) return [];
  return candidate.pages
    .map((page, pageIndex) => {
      if (!page || typeof page !== "object") return null;
      const current = page as Partial<RoomCoverBoardPage>;
      const elements = Array.isArray(current.elements)
        ? current.elements
            .map(normalizeRoomCoverBoardElement)
            .filter((element): element is RoomCoverBoardElement => Boolean(element))
        : [];
      return {
        id: typeof current.id === "string" && current.id ? current.id : crypto.randomUUID(),
        title:
          typeof current.title === "string" && current.title.trim()
            ? current.title
            : `Board ${pageIndex + 1}`,
        roomId: typeof current.roomId === "string" && current.roomId ? current.roomId : null,
        hidden: current.hidden === true,
        roomApprovalStatus:
          current.roomApprovalStatus === "approved" || current.roomApprovalStatus === "declined"
            ? current.roomApprovalStatus
            : undefined,
        declinedMaterialItems: Array.isArray(current.declinedMaterialItems)
          ? (current.declinedMaterialItems as DeclinedBoardMaterialItem[])
          : undefined,
        elements,
      } satisfies RoomCoverBoardPage;
    })
    .filter((page): page is RoomCoverBoardPage => Boolean(page));
}

function getRoomCoverBoardPage(value: string | null | undefined, pages: RoomCoverBoardPage[]) {
  if (!value?.startsWith(DESIGN_BOARD_ROOM_COVER_PREFIX)) return null;
  const pageId = value.slice(DESIGN_BOARD_ROOM_COVER_PREFIX.length);
  return pages.find((page) => page.id === pageId && page.hidden !== true) ?? null;
}

function getAutomaticRoomCoverBoardPage(room: Room, pages: RoomCoverBoardPage[]) {
  const normalize = (value: string) => value.trim().toLowerCase();
  const visibleElementCount = (page: RoomCoverBoardPage) =>
    page.elements.filter((element) => element.visible !== false).length;
  return (
    pages.find((page) => page.hidden !== true && page.roomId === room.id && visibleElementCount(page) > 0) ??
    pages.find(
      (page) =>
        page.hidden !== true &&
        normalize(page.title) === normalize(room.name) &&
        visibleElementCount(page) > 0,
    ) ??
    null
  );
}

function RoomCoverBoardPreview({ page }: { page: RoomCoverBoardPage }) {
  const elements = [...page.elements]
    .filter((element) => element.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      {elements.length ? (
        elements.map((element) => (
          <RoomCoverBoardPreviewElement key={element.id} element={element} />
        ))
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          Empty board
        </div>
      )}
    </div>
  );
}

function RoomCoverBoardPreviewElement({ element }: { element: RoomCoverBoardElement }) {
  const left = `${(element.x / DESIGN_BOARD_PREVIEW_WIDTH) * 100}%`;
  const top = `${(element.y / DESIGN_BOARD_PREVIEW_HEIGHT) * 100}%`;
  const width = `${(element.width / DESIGN_BOARD_PREVIEW_WIDTH) * 100}%`;
  const height = `${(element.height / DESIGN_BOARD_PREVIEW_HEIGHT) * 100}%`;
  const transform = element.rotation ? `rotate(${element.rotation}deg)` : undefined;

  if (element.type === "image") {
    const src = normalizeSupabaseImageUrl(element.backgroundRemovedUrl || element.src);
    if (!src) return null;
    return (
      <div
        className="absolute"
        style={{ left, top, width, height, transform, transformOrigin: "center center" }}
      >
        <img src={src} alt={element.text || ""} className="h-full w-full object-contain" loading="lazy" />
      </div>
    );
  }

  if (element.type === "shape") {
    return (
      <div
        className="absolute"
        style={{
          left,
          top,
          width,
          height,
          transform,
          transformOrigin: "center center",
          background: element.background || "#e7e0d5",
        }}
      />
    );
  }

  return (
    <div
      className="absolute whitespace-pre-wrap break-words leading-tight"
      style={{
        left,
        top,
        width,
        minHeight: height,
        transform,
        transformOrigin: "center center",
        color: element.color || "#1c1814",
        fontFamily: element.fontFamily || "var(--font-montserrat)",
        fontSize: `clamp(6px, ${(element.fontSize ?? 24) / 14}px, 22px)`,
        letterSpacing: `${Math.max(0, element.letterSpacing ?? 0) / 10}em`,
      }}
    >
      {element.text}
    </div>
  );
}

function RoomCard({
  room,
  projectId,
  canDelete,
  boardPages,
}: {
  room: Room;
  projectId: string;
  canDelete: boolean;
  boardPages: RoomCoverBoardPage[];
}) {
  const qc = useQueryClient();
  const [savingRoomDecision, setSavingRoomDecision] = useState(false);
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
  const renderingHero = images.find((image) => image.kind === "rendering");
  const sketchupHero = images.find((image) => image.kind === "sketchup");
  const manualBoardPage = getRoomCoverBoardPage(room.cover_image_url, boardPages);
  const automaticBoardPage =
    !room.cover_image_url && !renderingHero && !sketchupHero
      ? getAutomaticRoomCoverBoardPage(room, boardPages)
      : null;
  const selectedBoardPage = manualBoardPage ?? automaticBoardPage;
  const heroUrl =
    selectedBoardPage ? null : room.cover_image_url || renderingHero?.url || sketchupHero?.url || null;
  const roomBoardPages = boardPages.filter(
    (page) => page.roomId === room.id || page.id === selectedBoardPage?.id,
  );
  const roomApprovalStatus =
    roomBoardPages.length > 0 && roomBoardPages.every((page) => page.roomApprovalStatus === "declined")
      ? "declined"
      : roomBoardPages.length > 0 &&
          roomBoardPages.every((page) => page.roomApprovalStatus === "approved")
        ? "approved"
        : null;

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

  const setRoomDecision = async (decision: "approved" | "declined" | "neutral") => {
    if (!roomBoardPages.length) {
      toast.error("Assign a design board page to this room before choosing an option.");
      return;
    }
    if (
      decision === "declined" &&
      !confirm(
        `Decline ${room.name}? Its linked design board page will be hidden and its board-sourced materials will be removed from this project. Product Catalog entries will remain.`,
      )
    ) {
      return;
    }

    setSavingRoomDecision(true);
    try {
      const currentBoard = await db.getDesignBoard(projectId);
      if (!currentBoard || !currentBoard.board_state || typeof currentBoard.board_state !== "object") {
        throw new Error("Could not find this project's design board.");
      }
      const currentState = currentBoard.board_state as { pages?: unknown[] };
      if (!Array.isArray(currentState.pages)) {
        throw new Error("Could not find this project's design board pages.");
      }
      const roomBoardPageIds = new Set(roomBoardPages.map((page) => page.id));
      const affectedPageIds = currentState.pages.flatMap((page) => {
        if (!page || typeof page !== "object") return [];
        const candidate = page as { id?: unknown; roomId?: unknown };
        return (candidate.roomId === room.id ||
          (typeof candidate.id === "string" && roomBoardPageIds.has(candidate.id))) &&
          typeof candidate.id === "string"
          ? [candidate.id]
          : [];
      });
      if (!affectedPageIds.length) {
        throw new Error("No design board page is assigned to this room.");
      }

      const materialItems = (await db.listMaterialItemsByProject(projectId)) ?? [];
      const staleItems = materialItems.filter(
        (item) => item.source_board_page_id && affectedPageIds.includes(item.source_board_page_id),
      );
      const snapshotsByPageId = new Map<string, DeclinedBoardMaterialItem[]>();
      for (const item of staleItems) {
        if (!item.source_board_page_id) continue;
        const { id: _id, created_at: _createdAt, updated_at: _updatedAt, product: _product, room_product: _roomProduct, ...snapshot } = item;
        snapshotsByPageId.set(item.source_board_page_id, [
          ...(snapshotsByPageId.get(item.source_board_page_id) ?? []),
          snapshot,
        ]);
      }

      const nextBoardState = {
        ...currentState,
        pages: currentState.pages.map((page) => {
          if (!page || typeof page !== "object") return page;
          const candidate = page as { id?: unknown };
          if (typeof candidate.id !== "string" || !affectedPageIds.includes(candidate.id)) return page;
          const nextPage = {
            ...page,
            hidden: decision === "declined",
            ...(decision === "declined"
              ? { declinedMaterialItems: snapshotsByPageId.get((page as { id?: string }).id ?? "") ?? [] }
              : {}),
            ...(decision === "declined" ? { presentationVisible: false } : {}),
          };
          if (decision === "neutral") {
            delete (nextPage as { roomApprovalStatus?: unknown }).roomApprovalStatus;
            delete (nextPage as { declinedMaterialItems?: unknown }).declinedMaterialItems;
          } else {
            (nextPage as { roomApprovalStatus?: "approved" | "declined" }).roomApprovalStatus = decision;
          }
          return nextPage;
        }),
      };
      const savedBoard = await db.updateDesignBoardIfFresh(
        projectId,
        nextBoardState,
        currentBoard.updated_at,
      );
      if (!savedBoard) {
        throw new Error("The design board changed. Refresh and try again.");
      }

      let removed = 0;
      if (decision === "declined") {
        const staleMaterialIds = new Set(staleItems.map((item) => item.id));
        const roomProductIdsToRemove = new Set<string>();
        for (const item of staleItems) {
          await db.deleteMaterialItem(item.id);
          if (item.room_product?.id && item.product_id) {
            const stillUsed = materialItems.some(
              (candidate) =>
                candidate.id !== item.id &&
                !staleMaterialIds.has(candidate.id) &&
                candidate.room_id === item.room_id &&
                candidate.product_id === item.product_id,
            );
            if (!stillUsed) roomProductIdsToRemove.add(item.room_product.id);
          }
          removed += 1;
        }
        for (const roomProductId of roomProductIdsToRemove) {
          await db.removeRoomProduct(roomProductId);
        }
      } else {
        const approvedPages = currentState.pages.filter((page) => {
          if (!page || typeof page !== "object") return false;
          const pageId = (page as { id?: unknown }).id;
          return typeof pageId === "string" && affectedPageIds.includes(pageId);
        });
        const savedSnapshots = approvedPages.flatMap((page) => {
          const snapshots = (page as { declinedMaterialItems?: unknown }).declinedMaterialItems;
          return Array.isArray(snapshots) ? (snapshots as DeclinedBoardMaterialItem[]) : [];
        });
        const fallbackSnapshots = savedSnapshots.length
          ? []
          : (
              await Promise.all(
                approvedPages.flatMap((page) => {
                  const boardPage = page as { id?: unknown; elements?: unknown[] };
                  if (typeof boardPage.id !== "string" || !Array.isArray(boardPage.elements)) {
                    return [];
                  }
                  return boardPage.elements.map(async (element) => {
                    if (!element || typeof element !== "object") return null;
                    const boardElement = element as {
                      id?: unknown;
                      type?: unknown;
                      productId?: unknown;
                      label?: unknown;
                      productName?: unknown;
                      link?: unknown;
                      materialLinkCleared?: unknown;
                      materialCategory?: unknown;
                      materialQuantity?: unknown;
                      materialFinish?: unknown;
                      finish?: unknown;
                      notes?: unknown;
                      src?: unknown;
                      backgroundRemovedUrl?: unknown;
                      materialExcludeFromMaterials?: unknown;
                    };
                    if (
                      boardElement.type !== "image" ||
                      boardElement.materialExcludeFromMaterials === true ||
                      typeof boardElement.id !== "string" ||
                      typeof boardElement.productId !== "string"
                    ) {
                      return null;
                    }
                    const product = await db.getProduct(boardElement.productId);
                    if (!product) return null;
                    const label =
                      (typeof boardElement.label === "string" && boardElement.label.trim()) ||
                      (typeof boardElement.productName === "string" && boardElement.productName.trim()) ||
                      product.name;
                    const finish =
                      (typeof boardElement.materialFinish === "string" &&
                        boardElement.materialFinish.trim()) ||
                      (typeof boardElement.finish === "string" && boardElement.finish.trim()) ||
                      product.finish ||
                      null;
                    const link =
                      boardElement.materialLinkCleared === true
                        ? null
                        : (typeof boardElement.link === "string" && boardElement.link.trim()) ||
                          product.product_url ||
                          null;
                    const imageUrl =
                      (typeof boardElement.src === "string" && boardElement.src) ||
                      (typeof boardElement.backgroundRemovedUrl === "string" &&
                        boardElement.backgroundRemovedUrl) ||
                      product.image_url ||
                      null;
                    return {
                      room_id: room.id,
                      project_id: projectId,
                      item_label: label,
                      client_product_name: buildClientProductName(room.name, label),
                      category:
                        (typeof boardElement.materialCategory === "string" &&
                          boardElement.materialCategory) ||
                        product.category,
                      is_required: false,
                      sort_order: 0,
                      cad_label: null,
                      product_url: link,
                      quantity:
                        typeof boardElement.materialQuantity === "number" &&
                        boardElement.materialQuantity > 0
                          ? boardElement.materialQuantity
                          : 1,
                      color: finish,
                      image_url: imageUrl,
                      notes: typeof boardElement.notes === "string" ? boardElement.notes : null,
                      not_needed: false,
                      product_id: product.id,
                      source_board_id: null,
                      source_board_page_id: boardPage.id,
                      source_board_element_id: boardElement.id,
                      scrape_status: "scraped",
                      scrape_error: null,
                    } satisfies DeclinedBoardMaterialItem;
                  });
                }),
              )
            ).filter((snapshot): snapshot is DeclinedBoardMaterialItem => Boolean(snapshot));
        let nextSortOrder =
          Math.max(0, ...materialItems.filter((item) => item.room_id === room.id).map((item) => item.sort_order)) +
          1;
        const existingSourceElementIds = new Set(
          materialItems
            .map((item) => item.source_board_element_id)
            .filter((elementId): elementId is string => Boolean(elementId)),
        );
        const snapshotsToRestore = [...savedSnapshots, ...fallbackSnapshots]
          .filter(
            (snapshot) =>
              !snapshot.source_board_element_id ||
              !existingSourceElementIds.has(snapshot.source_board_element_id),
          )
          .map((snapshot) => ({
            ...snapshot,
            sort_order: snapshot.sort_order > 0 ? snapshot.sort_order : nextSortOrder++,
          }));
        const roomProducts = (await db.listRoomProducts(room.id)) ?? [];
        const existingProductIds = new Set(roomProducts.map((roomProduct) => roomProduct.product_id));

        for (const snapshot of snapshotsToRestore) {
          const restoredItem = { ...snapshot, not_needed: false };
          let { error } = await supabase.from("material_items").insert(restoredItem as any);
          if (error?.code === "42703" && error.message?.includes("image_url")) {
            const { image_url: _imageUrl, ...legacyItem } = restoredItem;
            ({ error } = await supabase.from("material_items").insert(legacyItem as any));
          }
          if (error) throw error;
          if (restoredItem.product_id && !existingProductIds.has(restoredItem.product_id)) {
            await db.addRoomProduct({
              room_id: room.id,
              product_id: restoredItem.product_id,
              is_key_selection: false,
            });
            existingProductIds.add(restoredItem.product_id);
          }
          removed += 1;
        }
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["designBoard", projectId] }),
        qc.invalidateQueries({ queryKey: ["rooms", projectId] }),
        qc.invalidateQueries({ queryKey: ["room", room.id] }),
        qc.invalidateQueries({ queryKey: ["roomProducts", room.id] }),
        qc.invalidateQueries({ queryKey: ["materialItems", projectId] }),
        qc.invalidateQueries({ queryKey: ["procurement"] }),
      ]);
      toast.success(
        decision === "approved"
          ? `${room.name} approved. Its design board page is visible and ${removed ? `${removed} material ${removed === 1 ? "item" : "items"} ${removed === 1 ? "was" : "were"} restored` : "its current materials are ready"}.`
          : decision === "neutral"
            ? `${room.name} returned to neutral. Its design board page is visible${removed ? ` and ${removed} material ${removed === 1 ? "item was" : "items were"} restored` : ""}.`
            : `${room.name} declined. Hidden its design board page${removed ? ` and removed ${removed} material ${removed === 1 ? "item" : "items"}` : ""}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this room option.");
    } finally {
      setSavingRoomDecision(false);
    }
  };

  return (
    <div className="group border border-border transition-colors hover:border-ink">
      <Link
        to="/projects/$id/rooms/$roomId"
        params={{ id: projectId, roomId: room.id }}
        className="block"
      >
        <div className="aspect-[4/3] bg-bone overflow-hidden">
          {selectedBoardPage ? (
            <RoomCoverBoardPreview page={selectedBoardPage} />
          ) : heroUrl ? (
            <img
              src={normalizeSupabaseImageUrl(heroUrl)}
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
      </Link>
      <div className="p-5 flex items-start justify-between gap-3">
        <Link
          to="/projects/$id/rooms/$roomId"
          params={{ id: projectId, roomId: room.id }}
          className="min-w-0 hover:text-ink"
        >
          <h3 className="font-display text-2xl leading-tight truncate">{room.name}</h3>
          <p className="text-xs text-muted-foreground mt-2">
            {sketchups} SketchUp · {renderings} Renderings · {selections.length} Selections
          </p>
        </Link>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            {canDelete && (
              <>
                <EditRoomNameDialog currentName={room.name} onSave={rename} />
                <RoomCoverImageDialog
                  room={room}
                  images={images}
                  boardPages={boardPages}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
                    qc.invalidateQueries({ queryKey: ["room", room.id] });
                  }}
                />
                <button onClick={remove} className="text-muted-foreground hover:text-ink">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={() => void setRoomDecision("approved")}
              disabled={savingRoomDecision || !roomBoardPages.length}
              className="inline-flex items-center gap-1 border border-emerald-700 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45"
              title={roomBoardPages.length ? "Keep this room option and show its design board" : "Assign a design board page to this room first"}
            >
              <CheckCircle2 className="h-3 w-3" /> Approve
            </button>
            <button
              type="button"
              onClick={() =>
                void setRoomDecision(roomApprovalStatus === "declined" ? "neutral" : "declined")
              }
              disabled={savingRoomDecision || !roomBoardPages.length}
              className="inline-flex items-center gap-1 border border-rose-700 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-rose-800 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
              title={
                roomBoardPages.length
                  ? roomApprovalStatus === "declined"
                    ? "Clear the decline and return this room to neutral"
                    : "Hide this room option and remove its project materials"
                  : "Assign a design board page to this room first"
              }
            >
              <X className="h-3 w-3" /> Decline
            </button>
          </div>
          {roomApprovalStatus && (
            <span
              className={
                roomApprovalStatus === "approved"
                  ? "text-[10px] uppercase tracking-[0.12em] text-emerald-800"
                  : "text-[10px] uppercase tracking-[0.12em] text-rose-800"
              }
            >
              {roomApprovalStatus === "approved" ? "Approved option" : "Declined option"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RoomCoverImageDialog({
  room,
  images,
  boardPages,
  onSaved,
}: {
  room: Room;
  images: RoomImage[];
  boardPages: RoomCoverBoardPage[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const presentationImageIds = new Set(
    [
      room.presentation_rendering_image_id,
      room.presentation_sketchup_image_id,
      ...images.filter((image) => image.presentation_visible).map((image) => image.id),
    ].filter(Boolean) as string[],
  );
  const presentationImages = images.filter((image) => presentationImageIds.has(image.id));
  const nonPresentationImages = images.filter((image) => !presentationImageIds.has(image.id));

  const save = async (coverImageUrl: string | null) => {
    await db.updateRoom(room.id, { cover_image_url: coverImageUrl });
    onSaved();
    setOpen(false);
    toast.success(coverImageUrl ? "Room image updated" : "Room image reset");
  };

  const chooseImage = (event: React.MouseEvent, url: string) => {
    event.preventDefault();
    event.stopPropagation();
    void save(url);
  };

  const chooseBoardPage = (event: React.MouseEvent, pageId: string) => {
    event.preventDefault();
    event.stopPropagation();
    void save(`${DESIGN_BOARD_ROOM_COVER_PREFIX}${pageId}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
          }}
          className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition hover:border-ink hover:text-ink"
          title="Choose room image"
          aria-label={`Choose image for ${room.name}`}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Cover
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            Choose Image for {room.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void save(null);
            }}
            className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:border-ink hover:text-ink"
          >
            <X className="h-3.5 w-3.5" /> Reset to automatic image
          </button>

          <RoomCoverImageSection
            title="Presentation Picks"
            emptyText="No presentation images picked for this room yet."
            images={presentationImages}
            onChoose={chooseImage}
          />

          <RoomCoverImageSection
            title="Room Images"
            emptyText="No other room images yet."
            images={nonPresentationImages}
            onChoose={chooseImage}
          />

          <div>
            <div className="eyebrow mb-2">Design Board Pages</div>
            {boardPages.length ? (
              <div className="grid max-h-80 grid-cols-2 gap-3 overflow-auto sm:grid-cols-3">
                {boardPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={(event) => chooseBoardPage(event, page.id)}
                    className="group overflow-hidden border border-border bg-white text-left transition hover:border-ink"
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-bone">
                      <RoomCoverBoardPreview page={page} />
                    </div>
                    <div className="truncate px-3 py-2 text-xs text-muted-foreground group-hover:text-ink">
                      {page.title}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-border bg-bone/30 px-4 py-5 text-sm text-muted-foreground">
                No design board pages available yet.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoomCoverImageSection({
  title,
  emptyText,
  images,
  onChoose,
}: {
  title: string;
  emptyText: string;
  images: RoomImage[];
  onChoose: (event: React.MouseEvent, url: string) => void;
}) {
  return (
    <div>
      <div className="eyebrow mb-2">{title}</div>
      {images.length ? (
        <div className="grid max-h-80 grid-cols-2 gap-3 overflow-auto sm:grid-cols-4">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={(event) => onChoose(event, image.url)}
              className="group relative aspect-[4/3] overflow-hidden border border-border bg-bone transition hover:border-ink"
            >
              <img
                src={normalizeSupabaseImageUrl(image.url)}
                alt={image.caption ?? title}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span className="absolute bottom-1 left-1 right-1 truncate bg-ink/75 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary-foreground">
                {image.caption || image.kind}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-border bg-bone/30 px-4 py-5 text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
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
                <img src={normalizeSupabaseImageUrl(currentUrl)} alt="current cover" className="w-full h-full object-cover" />
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
                      src={normalizeSupabaseImageUrl(img.url)}
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

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

// Required to satisfy any tooling that imports field/textarea/etc. unused
void Textarea;
