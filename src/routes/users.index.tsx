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

export const Route = createFileRoute("/users/")({
  head: () => ({ meta: [{ title: "Users — MERAV Studio" }] }),
  component: UsersPage,
});

function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("Employee");
  const [password, setPassword] = useState("merav");
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
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await authedFetch("/api/users", {
      method: "POST",
      body: JSON.stringify({ full_name: fullName, email, role, password }),
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
    setPassword("merav");
    await loadUsers();
  };

  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-12 lg:py-16 max-w-[1200px]">
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
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
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
              <div key={user.id} className="grid grid-cols-[1fr_auto] gap-4 py-5 border-b border-border">
                <div>
                  <div className="font-display text-xl">{user.full_name}</div>
                  <div className="text-sm text-muted-foreground">{user.email}</div>
                </div>
                <div className="self-center text-right">
                  <div className="eyebrow">{user.role}</div>
                  <div className="text-xs text-muted-foreground mt-1">{user.is_active ? "Active" : "Inactive"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
