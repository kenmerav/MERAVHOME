import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ContactRound,
  FileText,
  LayoutTemplate,
  Palette,
  Plus,
  Truck,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loadEaWorkspace, saveEaWorkspace } from "@/lib/eaWorkspaceClient";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/$id/operations")({
  head: () => ({ meta: [{ title: "Project Operations - MERAV Studio" }] }),
  component: ProjectOperationsPage,
});

function ProjectOperationsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["eaWorkspace"],
    queryFn: loadEaWorkspace,
  });
  const project = data?.projects.find((item) => item.id === id);
  const saved = data?.operations.find((item) => item.project_id === id);
  const [form, setForm] = useState({
    lifecycle_status: "active",
    phase: "",
    aliases: "",
    next_milestone: "",
    current_blocker: "",
    waiting_party: "",
    next_action: "",
    responsible_user_id: "",
    responsible_contact_id: "",
    follow_up_date: "",
  });
  const [busy, setBusy] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const team = data?.assignments.filter((item) => item.project_id === id) ?? [];
  const tasks = data?.tasks.filter((item) => item.project_id === id) ?? [];

  useEffect(() => {
    if (!saved) return;
    setForm({
      lifecycle_status: saved.lifecycle_status,
      phase: saved.phase ?? "",
      aliases: saved.aliases.join(", "),
      next_milestone: saved.next_milestone ?? "",
      current_blocker: saved.current_blocker ?? "",
      waiting_party: saved.waiting_party ?? "",
      next_action: saved.next_action ?? "",
      responsible_user_id: saved.responsible_user_id ?? "",
      responsible_contact_id: saved.responsible_contact_id ?? "",
      follow_up_date: saved.follow_up_date ?? "",
    });
  }, [saved]);

  const set = (key: string, value: string) => setForm((prior) => ({ ...prior, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      await saveEaWorkspace({ action: "save_operations", project_id: id, ...form });
      toast.success("Project operations updated");
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save project operations.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1450px]">
        <Link
          to="/ea-desk"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> EA Desk
        </Link>
        {isLoading ? (
          <div className="py-20 text-sm text-muted-foreground">Loading project operations…</div>
        ) : error ? (
          <div className="mt-6 border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error instanceof Error ? error.message : "Unable to load project operations."}
          </div>
        ) : !project ? (
          <div className="mt-8 border border-dashed border-border p-10 text-sm text-muted-foreground">
            Project not found or access is not authorized.
          </div>
        ) : (
          <>
            <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="eyebrow mb-2">Project operations</div>
                <h1 className="font-display text-5xl lg:text-6xl">{project.name}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {project.client_name} · {project.project_type}
                </p>
              </div>
              <Link
                to="/projects/$id"
                params={{ id }}
                className="border border-ink px-4 py-2.5 text-sm"
              >
                Open main project
              </Link>
            </header>

            {data?.setupNeeded && (
              <div className="mt-6 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                Apply <code>20260909100000_add_ea_workspace.sql</code> to local Supabase before
                testing saved data.
              </div>
            )}

            <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_.8fr]">
              <section className="border border-border p-5 lg:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="eyebrow mb-2">Current state</div>
                    <h2 className="font-display text-3xl">What happens next</h2>
                  </div>
                  {saved?.last_reviewed_at && (
                    <span className="text-xs text-muted-foreground">
                      Reviewed {new Date(saved.last_reviewed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Operations status">
                    <select
                      value={form.lifecycle_status}
                      onChange={(e) => set("lifecycle_status", e.target.value)}
                      className="h-10 w-full border border-input bg-background px-3 text-sm"
                    >
                      <option value="active">Active</option>
                      <option value="on_hold">On hold</option>
                      <option value="completed">Completed</option>
                    </select>
                  </Field>
                  <Field label="Current phase">
                    <Input
                      value={form.phase}
                      onChange={(e) => set("phase", e.target.value)}
                      placeholder={project.status}
                    />
                  </Field>
                  <Field label="Aliases used in email" className="md:col-span-2">
                    <Input
                      value={form.aliases}
                      onChange={(e) => set("aliases", e.target.value)}
                      placeholder="Comma-separated confirmed aliases"
                    />
                  </Field>
                  <Field label="Next milestone">
                    <Input
                      value={form.next_milestone}
                      onChange={(e) => set("next_milestone", e.target.value)}
                      placeholder={nextMilestone(data?.milestones ?? [], id)}
                    />
                  </Field>
                  <Field label="Follow-up date">
                    <Input
                      type="date"
                      value={form.follow_up_date}
                      onChange={(e) => set("follow_up_date", e.target.value)}
                    />
                  </Field>
                  <Field label="Current blocker" className="md:col-span-2">
                    <Textarea
                      rows={3}
                      value={form.current_blocker}
                      onChange={(e) => set("current_blocker", e.target.value)}
                      placeholder="Leave blank if no confirmed blocker"
                    />
                  </Field>
                  <Field label="Waiting party">
                    <Input
                      value={form.waiting_party}
                      onChange={(e) => set("waiting_party", e.target.value)}
                      placeholder="Person or company that owes the answer"
                    />
                  </Field>
                  <Field label="Responsible person">
                    <select
                      value={form.responsible_user_id}
                      onChange={(e) => set("responsible_user_id", e.target.value)}
                      className="h-10 w-full border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Needs confirmation</option>
                      {data?.profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.full_name || profile.email}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Next action" className="md:col-span-2">
                    <Textarea
                      rows={3}
                      value={form.next_action}
                      onChange={(e) => set("next_action", e.target.value)}
                      placeholder="The next concrete handoff or follow-up"
                    />
                  </Field>
                </div>
                <button
                  disabled={busy}
                  onClick={save}
                  className="mt-5 bg-ink px-5 py-2.5 text-sm text-white disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save project operations"}
                </button>
              </section>

              <section className="border border-border p-5 lg:p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="eyebrow mb-2">Project team</div>
                    <h2 className="font-display text-3xl">Who to ask</h2>
                  </div>
                  <button
                    onClick={() => setTeamOpen(true)}
                    className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
                {team.length === 0 ? (
                  <div className="mt-6 border border-dashed border-border p-6 text-sm text-muted-foreground">
                    No team assignments are confirmed yet. Adding a contact here does not grant
                    Studio access.
                  </div>
                ) : (
                  <div className="mt-6 space-y-3">
                    {team.map((member) => (
                      <div key={member.id} className="border border-border bg-bone/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-medium">{member.contact.name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {[member.role_on_project, member.contact.company]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <span
                            className={`text-[10px] uppercase tracking-[.12em] ${member.verification_status === "verified" ? "text-emerald-700" : "text-amber-700"}`}
                          >
                            {member.verification_status === "verified"
                              ? "Verified"
                              : "Needs confirmation"}
                          </span>
                        </div>
                        <div className="mt-3 space-y-2 text-sm">
                          <p>
                            <span className="text-muted-foreground">Handles: </span>
                            {member.responsibilities || "Needs confirmation"}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Ask about: </span>
                            {member.ask_them_about || "Needs confirmation"}
                          </p>
                        </div>
                        <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                          {member.contact.email ||
                            member.contact.phone ||
                            "Contact details need confirmation"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className="mt-8 border border-border p-5 lg:p-6">
              <div className="eyebrow mb-2">Connected Studio work</div>
              <h2 className="font-display text-3xl">Open the current source</h2>
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                <DeepLink
                  to={`/projects/${id}/design-boards`}
                  label="Design boards"
                  icon={Palette}
                />
                <DeepLink
                  to={`/projects/${id}/materials`}
                  label="Materials"
                  icon={LayoutTemplate}
                />
                <DeepLink to={`/projects/${id}/approvals`} label="Approvals" icon={CheckCircle2} />
                <DeepLink to={`/procurement?project=${id}`} label="Procurement" icon={Truck} />
                <DeepLink
                  to={`/projects/${id}/construction-docs`}
                  label="Drawings"
                  icon={FileText}
                />
                <DeepLink to={`/specbooks/${id}`} label="Spec book" icon={BookOpen} />
                <DeepLink to="/ea-desk" label="EA Desk" icon={Users} />
              </div>
            </section>

            <section className="mt-8 border border-border p-5 lg:p-6">
              <div className="eyebrow mb-2">Relevant tasks</div>
              <h2 className="font-display text-3xl">Follow-ups for this project</h2>
              {tasks.length === 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">
                  No open Command Center tasks are linked to this project.
                </p>
              ) : (
                <div className="mt-5 divide-y divide-border border-y border-border">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="grid grid-cols-1 gap-2 py-4 md:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <div className="font-medium">{task.title}</div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {task.ea_next_action || task.notes || "EA next action needs confirmation"}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {task.next_follow_up_date
                          ? `Follow up ${formatDate(task.next_follow_up_date)}`
                          : task.due_date
                            ? `Due ${formatDate(task.due_date)}`
                            : task.status}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <AssignmentDialog
        open={teamOpen}
        projectId={id}
        contacts={data?.contacts ?? []}
        onClose={() => setTeamOpen(false)}
      />
    </AppShell>
  );
}

function AssignmentDialog({
  open,
  projectId,
  contacts,
  onClose,
}: {
  open: boolean;
  projectId: string;
  contacts: Array<{
    id: string;
    name: string;
    company: string | null;
    verification_status: string;
  }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    contact_id: "",
    role_on_project: "",
    responsibilities: "",
    ask_them_about: "",
    preferred_communication: "",
    verification_status: "needs_verification",
    source_reference: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => setForm((prior) => ({ ...prior, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      await saveEaWorkspace({ action: "save_assignment", project_id: projectId, ...form });
      toast.success("Project team updated");
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      setForm({
        contact_id: "",
        role_on_project: "",
        responsibilities: "",
        ask_them_about: "",
        preferred_communication: "",
        verification_status: "needs_verification",
        source_reference: "",
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add project contact.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="eyebrow mb-2">Project-specific responsibility</div>
          <DialogTitle className="font-display text-3xl">Add project team member</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This creates a roster assignment only. It does not create a user account or grant Studio
          access.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Person">
            <select
              value={form.contact_id}
              onChange={(e) => set("contact_id", e.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">Choose a directory contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.company ? ` · ${contact.company}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role on this project">
            <Input
              value={form.role_on_project}
              onChange={(e) => set("role_on_project", e.target.value)}
              placeholder="GC, design lead, drawing support…"
            />
          </Field>
          <Field label="What they handle" className="md:col-span-2">
            <Textarea
              rows={3}
              value={form.responsibilities}
              onChange={(e) => set("responsibilities", e.target.value)}
            />
          </Field>
          <Field label="What the EA should ask them" className="md:col-span-2">
            <Textarea
              rows={3}
              value={form.ask_them_about}
              onChange={(e) => set("ask_them_about", e.target.value)}
            />
          </Field>
          <Field label="Preferred communication">
            <Input
              value={form.preferred_communication}
              onChange={(e) => set("preferred_communication", e.target.value)}
            />
          </Field>
          <Field label="Verification">
            <select
              value={form.verification_status}
              onChange={(e) => set("verification_status", e.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="needs_verification">Needs verification</option>
              <option value="verified">Verified</option>
            </select>
          </Field>
          <Field label="Supporting source" className="md:col-span-2">
            <Input
              value={form.source_reference}
              onChange={(e) => set("source_reference", e.target.value)}
            />
          </Field>
        </div>
        <button
          disabled={busy}
          onClick={save}
          className="ml-auto bg-ink px-5 py-2.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add to project team"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="eyebrow">{label}</Label>
      {children}
    </div>
  );
}
function DeepLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof ContactRound;
}) {
  return (
    <a
      href={to}
      className="flex min-h-24 flex-col justify-between border border-border p-3 text-sm hover:border-ink"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </a>
  );
}
function nextMilestone(
  rows: Array<{ project_id: string; title: string; status: string }>,
  projectId: string,
) {
  return (
    rows.find(
      (row) => row.project_id === projectId && !["complete", "skipped"].includes(row.status),
    )?.title ?? "Needs confirmation"
  );
}
function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
