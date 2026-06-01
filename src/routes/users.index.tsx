import { createFileRoute } from "@tanstack/react-router";
import type React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { UserProfile, UserRole } from "@/lib/db";

const ROLES: UserRole[] = ["Admin", "Employee", "Contractor", "Client"];
const ASSIGNABLE_ROLES: UserRole[] = ["Client", "Contractor"];

type UserProject = {
  id: string;
  name: string;
  client_name: string;
  status: string;
};

type ManagedUser = UserProfile & {
  assigned_project_ids?: string[];
};

function roleLabel(role: UserRole) {
  return role === "Contractor" ? "Builder / GC" : role;
}

function canAssignProjects(role: UserRole) {
  return ASSIGNABLE_ROLES.includes(role);
}

export const Route = createFileRoute("/users/")({
  head: () => ({ meta: [{ title: "Users — MERAV Studio" }] }),
  component: UsersPage,
});

function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [projects, setProjects] = useState<UserProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("Employee");
  const [hourlyRate, setHourlyRate] = useState("");
  const [password, setPassword] = useState("merav");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const authedFetch = async (url: string, init: RequestInit = {}) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  };

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    const res = await authedFetch("/api/users");
    const body = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(body.error || "Unable to load users.");
      return;
    }
    setUsers(body.users ?? []);
    setProjects(body.projects ?? []);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await authedFetch("/api/users", {
      method: "POST",
      body: JSON.stringify({
        full_name: fullName,
        email,
        role,
        hourly_rate: role === "Employee" ? moneyNumber(hourlyRate) : 0,
        password,
        project_ids: canAssignProjects(role) ? projectIds : [],
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error || "Unable to create user.");
      return;
    }
    toast.success("User created");
    setFullName("");
    setEmail("");
    setRole("Employee");
    setHourlyRate("");
    setPassword("merav");
    setProjectIds([]);
    await loadUsers();
  };

  const updateUser = async (user: ManagedUser, patch: Partial<UserProfile> & { password?: string; project_ids?: string[] }) => {
    setBusy(true);
    const res = await authedFetch("/api/users", {
      method: "PATCH",
      body: JSON.stringify({
        id: user.id,
        full_name: patch.full_name ?? user.full_name,
        role: patch.role ?? user.role,
        hourly_rate: (patch.role ?? user.role) === "Employee" ? patch.hourly_rate ?? user.hourly_rate : 0,
        is_active: patch.is_active ?? user.is_active,
        password: patch.password,
        project_ids: patch.project_ids,
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error || "Unable to update user.");
      return;
    }
    toast.success("User updated");
    await loadUsers();
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1200px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Access</div>
          <h1 className="editorial-hero text-5xl lg:text-6xl">Users</h1>
          <p className="mt-4 text-muted-foreground max-w-2xl">
            Create accounts now and assign a role. Detailed permission rules will be layered on top of these roles next.
          </p>
        </div>

        <div className="grid lg:grid-cols-[360px_1fr] gap-10 items-start">
          <form onSubmit={createUser} className="border border-border p-6 bg-background space-y-5">
            <div>
              <div className="font-display text-2xl">Create User</div>
              <p className="text-sm text-muted-foreground mt-1">Default temporary password is merav.</p>
            </div>
            <div>
              <Label className="eyebrow">Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Client" required />
            </div>
            <div>
              <Label className="eyebrow">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" required />
            </div>
            <div>
              <Label className="eyebrow">Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm"
              >
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </div>
            {role === "Employee" && (
              <div>
                <Label className="eyebrow">Hourly Rate</Label>
                <Input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="$28" />
              </div>
            )}
            {canAssignProjects(role) && (
              <ProjectAssignmentPicker
                projects={projects}
                selectedProjectIds={projectIds}
                onChange={setProjectIds}
              />
            )}
            <div>
              <Label className="eyebrow">Temporary Password</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Creating..." : "Create Account"}</Button>
            {error && <div className="text-sm text-destructive">{error}</div>}
          </form>

          <div className="border-t border-border">
            {loading ? (
              <div className="py-12 text-sm text-muted-foreground">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="py-12 text-sm text-muted-foreground">No users yet.</div>
            ) : users.map((user) => (
              <UserRow key={user.id} user={user} projects={projects} busy={busy} onSave={updateUser} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function UserRow({
  user,
  projects,
  busy,
  onSave,
}: {
  user: ManagedUser;
  projects: UserProject[];
  busy: boolean;
  onSave: (user: ManagedUser, patch: Partial<UserProfile> & { password?: string; project_ids?: string[] }) => void;
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState<UserRole>(user.role);
  const [hourlyRate, setHourlyRate] = useState(String(user.hourly_rate ?? 0));
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>(user.assigned_project_ids ?? []);
  const isKen = user.email.toLowerCase() === "ken@meravinteriors.com";

  useEffect(() => {
    setFullName(user.full_name);
    setRole(user.role);
    setHourlyRate(String(user.hourly_rate ?? 0));
    setIsActive(user.is_active);
    setPassword("");
    setProjectIds(user.assigned_project_ids ?? []);
  }, [user]);

  const saveUser = () => {
    onSave(user, {
      full_name: fullName,
      role,
      hourly_rate: role === "Employee" ? moneyNumber(hourlyRate) : 0,
      is_active: isActive,
      password: password || undefined,
      project_ids: canAssignProjects(role) ? projectIds : [],
    });
  };

  return (
    <div className="py-5 border-b border-border space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-display text-xl">{user.full_name}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
        </div>
        <div className="text-right">
          <div className="eyebrow">{user.is_owner ? "Overall Admin" : roleLabel(user.role)}</div>
          <div className="text-xs text-muted-foreground mt-1">{user.is_active ? "Active" : "Inactive"}</div>
        </div>
      </div>

      <div className={role === "Employee" ? "grid md:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] gap-3" : "grid md:grid-cols-[1.2fr_0.8fr_0.8fr] gap-3"}>
        <div>
          <Label className="eyebrow">Name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label className="eyebrow">Role</Label>
          <select
            value={role}
            disabled={isKen}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        {role === "Employee" && (
          <div>
            <Label className="eyebrow">Hourly Rate</Label>
            <Input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="$28" />
          </div>
        )}
        <div>
          <Label className="eyebrow">Status</Label>
          <select
            value={isActive ? "active" : "inactive"}
            disabled={isKen}
            onChange={(e) => setIsActive(e.target.value === "active")}
            className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {canAssignProjects(role) && (
        <ProjectAssignmentPicker
          projects={projects}
          selectedProjectIds={projectIds}
          onChange={setProjectIds}
          compact
        />
      )}

      <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <Label className="eyebrow">Reset Password</Label>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep current password" />
        </div>
        <Button
          type="button"
          disabled={busy}
          onClick={saveUser}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function ProjectAssignmentPicker({
  projects,
  selectedProjectIds,
  onChange,
  compact = false,
}: {
  projects: UserProject[];
  selectedProjectIds: string[];
  onChange: (projectIds: string[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedProjects = projects.filter((project) => selectedProjectIds.includes(project.id));
  const selectedLabel =
    selectedProjects.length === 0
      ? "Choose project(s)"
      : selectedProjects.length <= 2
        ? selectedProjects.map((project) => project.name).join(", ")
        : `${selectedProjects.length} projects selected`;

  const toggleProject = (projectId: string) => {
    onChange(
      selectedProjectIds.includes(projectId)
        ? selectedProjectIds.filter((id) => id !== projectId)
        : [...selectedProjectIds, projectId],
    );
  };

  return (
    <div className="relative">
      <Label className="eyebrow">Assigned Projects</Label>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-2 flex h-10 w-full items-center justify-between gap-3 border border-input bg-background px-3 py-2 text-left text-sm"
      >
        <span className={selectedProjects.length ? "truncate text-ink" : "text-muted-foreground"}>{selectedLabel}</span>
        <span className="text-xs text-muted-foreground">{open ? "Close" : "Open"}</span>
      </button>
      {selectedProjects.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedProjects.slice(0, compact ? 3 : 5).map((project) => (
            <span key={project.id} className="rounded-full bg-bone px-2.5 py-1 text-[11px] text-muted-foreground">
              {project.name}
            </span>
          ))}
          {selectedProjects.length > (compact ? 3 : 5) && (
            <span className="rounded-full bg-bone px-2.5 py-1 text-[11px] text-muted-foreground">
              +{selectedProjects.length - (compact ? 3 : 5)} more
            </span>
          )}
        </div>
      )}
      {open && (
        <div className={`absolute z-30 mt-2 w-full border border-border bg-background shadow-lg ${compact ? "max-h-56" : "max-h-64"} overflow-y-auto`}>
          {projects.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No projects available yet.</div>
          ) : (
            <>
              {projects.map((project) => {
                const selected = selectedProjectIds.includes(project.id);
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => toggleProject(project.id)}
                    className={`flex w-full items-start justify-between gap-3 border-b border-border/70 px-3 py-2.5 text-left last:border-b-0 ${selected ? "bg-ink text-primary-foreground" : "hover:bg-bone/60"}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{project.name}</span>
                      <span className={selected ? "block text-xs text-primary-foreground/70" : "block text-xs text-muted-foreground"}>
                        {project.client_name} · {project.status}
                      </span>
                    </span>
                    <span className={selected ? "text-sm" : "text-xs text-muted-foreground"}>
                      {selected ? "Selected" : "Add"}
                    </span>
                  </button>
                );
              })}
              <div className="sticky bottom-0 flex justify-between gap-2 border-t border-border bg-background p-2">
                <button type="button" onClick={() => onChange([])} className="px-3 py-2 text-xs text-muted-foreground hover:text-ink">
                  Clear
                </button>
                <button type="button" onClick={() => setOpen(false)} className="bg-ink px-4 py-2 text-xs text-primary-foreground">
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function moneyNumber(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
