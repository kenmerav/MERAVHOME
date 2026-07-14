import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, FolderOpen, LayoutTemplate, Truck, Library, BookOpen, UserCog, LogOut, DollarSign, Menu, X, Clock, PanelLeftClose, PanelLeftOpen, ReceiptText, Bell, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { UserProfile } from "@/lib/db";
import {
  canLogHours,
  canManageStudio,
  canViewFinancials,
  canViewProcurement,
  canViewProductCatalog,
  isClientRole,
  isSharedProjectRole,
} from "@/lib/permissions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/project-management", label: "Project Management", icon: ListChecks },
  { to: "/catalog", label: "Product Catalog", icon: Library },
  { to: "/presentations", label: "Presentation Boards", icon: LayoutTemplate },
  { to: "/specbooks", label: "Spec Books", icon: BookOpen },
  { to: "/procurement", label: "Procurement", icon: Truck },
  { to: "/financials", label: "Financials", icon: DollarSign },
  { to: "/client/financials", label: "Invoices", icon: ReceiptText },
  { to: "/hours", label: "Hours", icon: Clock },
  { to: "/users", label: "Users", icon: UserCog },
];

type ReminderNotice = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  reminder_date: string | null;
  priority: string | null;
  assigned_to: string | null;
  project_name?: string | null;
};

type NoticeKind = "reminders" | "todos";

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("merav.sidebar.collapsed") === "true";
  });
  const [reminderNotices, setReminderNotices] = useState<ReminderNotice[]>([]);
  const [reminderNoticeOpen, setReminderNoticeOpen] = useState(false);
  const [noticeKind, setNoticeKind] = useState<NoticeKind>("reminders");

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 12000);
        if (!active) return;
        if (!data.session) {
          setLoadingAuth(false);
          navigate({ to: "/login" });
          return;
        }

        const { data: userProfile } = await withTimeout(
          supabase
            .from("user_profiles")
            .select("*")
            .eq("id", data.session.user.id)
            .maybeSingle(),
          12000,
        );
        if (!active) return;
        setProfile((userProfile as UserProfile | null) ?? null);
        setLoadingAuth(false);
      } catch (error) {
        console.warn("[AppShell] Unable to load auth session.", error);
        if (!active) return;
        setProfile(null);
        setLoadingAuth(false);
        navigate({ to: "/login" });
      }
    };

    loadSession();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate({ to: "/login" });
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    const isClientFinancials = loc.pathname.startsWith("/client/financials");
    const isStudioFinancials = loc.pathname.startsWith("/procurement") || loc.pathname.startsWith("/financials") || (loc.pathname.includes("/financials") && !isClientFinancials);
    if (!loadingAuth && isStudioFinancials && !canViewFinancials(profile)) {
      navigate({ to: "/" });
    }
  }, [loadingAuth, loc.pathname, navigate, profile]);

  useEffect(() => {
    if (
      !loadingAuth &&
      isSharedProjectRole(profile?.role) &&
      loc.pathname.startsWith("/catalog")
    ) {
      navigate({ to: "/" });
    }
  }, [loadingAuth, loc.pathname, navigate, profile]);

  useEffect(() => {
    if (loadingAuth || !canViewFinancials(profile) || typeof window === "undefined") return;
    let active = true;

    const loadReminderNotices = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/studio-reminders", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(body.reminders)) return;

        const today = localDateKey();
        const dueReminders = (body.reminders as ReminderNotice[]).filter((reminder) => {
          if (!reminderMatchesProfile(reminder, profile)) return false;
          const reminderDate = reminder.reminder_date;
          const dueDate = reminder.due_date;
          return (
            (reminderDate && reminderDate <= today) ||
            (dueDate && dueDate <= today)
          );
        });
        if (!active || dueReminders.length === 0) return;

        const reminderIds = dueReminders.map((reminder) => reminder.id).sort().join(".");
        const storageKey = `merav.reminder-notices.${profile?.id}.${today}.${reminderIds}`;
        if (window.localStorage.getItem(storageKey) === "seen") return;
        setNoticeKind("reminders");
        setReminderNotices(dueReminders);
        setReminderNoticeOpen(true);
      } catch (error) {
        console.warn("[AppShell] Unable to load reminder notices.", error);
      }
    };

    void loadReminderNotices();
    return () => {
      active = false;
    };
  }, [loadingAuth, profile]);

  useEffect(() => {
    if (
      loadingAuth ||
      !profile ||
      !isSharedProjectRole(profile.role) ||
      typeof window === "undefined"
    ) {
      return;
    }
    let active = true;

    const loadSharedTodoNotices = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/client-dashboard", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(body.todos)) return;

        const today = localDateKey();
        const dueTodos = body.todos
          .filter((todo: any) => todo?.kind === "project_todo")
          .filter((todo: any) => {
            const reminderDate = typeof todo.reminder_date === "string" ? todo.reminder_date : null;
            const dueDate = typeof todo.due_date === "string" ? todo.due_date : null;
            return (
              (reminderDate && reminderDate <= today) ||
              (dueDate && dueDate <= today)
            );
          })
          .map((todo: any) => ({
            id: String(todo.todo_id || todo.id),
            title: String(todo.title || "Project to-do"),
            notes: typeof todo.notes === "string" ? todo.notes : null,
            due_date: typeof todo.due_date === "string" ? todo.due_date : null,
            reminder_date: typeof todo.reminder_date === "string" ? todo.reminder_date : null,
            priority: null,
            assigned_to: "shared",
            project_name: typeof todo.project_name === "string" ? todo.project_name : null,
          }));
        if (!active || dueTodos.length === 0) return;

        const todoIds = dueTodos.map((todo: ReminderNotice) => todo.id).sort().join(".");
        const storageKey = `merav.shared-todo-notices.${profile.id}.${today}.${todoIds}`;
        if (window.localStorage.getItem(storageKey) === "seen") return;
        setNoticeKind("todos");
        setReminderNotices(dueTodos);
        setReminderNoticeOpen(true);
      } catch (error) {
        console.warn("[AppShell] Unable to load shared to-do notices.", error);
      }
    };

    void loadSharedTodoNotices();
    return () => {
      active = false;
    };
  }, [loadingAuth, profile]);

  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    window.localStorage.setItem("merav.sidebar.collapsed", String(desktopCollapsed));
  }, [desktopCollapsed]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">
        Loading MERAV Studio...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r border-border bg-sidebar sticky top-0 h-screen print:hidden transition-[width] duration-200",
          desktopCollapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={cn("pt-8 pb-10", desktopCollapsed ? "px-3" : "px-7")}>
          <div className={cn("flex items-start justify-between gap-3", desktopCollapsed && "flex-col items-center")}>
            <Link to="/" className={cn("block", desktopCollapsed && "text-center")}>
              <div className={cn("font-display tracking-tight leading-none", desktopCollapsed ? "text-xl" : "text-2xl")}>MERAV</div>
              {!desktopCollapsed && <div className="eyebrow mt-1.5">Studio</div>}
            </Link>
            <button
              type="button"
              onClick={() => setDesktopCollapsed((collapsed) => !collapsed)}
              className="inline-flex h-8 w-8 items-center justify-center border border-border bg-background text-muted-foreground transition hover:border-ink hover:text-ink"
              aria-label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {desktopCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <nav className={cn("flex-1 space-y-0.5", desktopCollapsed ? "px-2" : "px-3")}>
          {nav.map(({ to, label, icon: Icon, exact }) => {
            if (to === "/users" && !canManageStudio(profile)) return null;
            if (to === "/project-management" && isSharedProjectRole(profile?.role)) return null;
            if (to === "/catalog" && !canViewProductCatalog(profile)) return null;
            if (to === "/procurement" && !canViewProcurement(profile)) return null;
            if (to === "/financials" && !canViewFinancials(profile)) return null;
            if (to === "/client/financials" && !isClientRole(profile?.role)) return null;
            if (to === "/hours" && !canLogHours(profile)) return null;
            const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                title={desktopCollapsed ? label : undefined}
                className={cn(
                  "flex items-center rounded-sm text-sm transition-colors",
                  desktopCollapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-2.5",
                  active ? "bg-bone text-ink font-medium" : "text-muted-foreground hover:text-ink hover:bg-bone/60"
                )}
              >
                <Icon className="w-[15px] h-[15px] shrink-0 stroke-[1.5]" />
                {!desktopCollapsed && label}
              </Link>
            );
          })}
        </nav>
        <div className={cn("border-t border-border py-6", desktopCollapsed ? "px-3" : "px-7")}>
          {profile && (
            <div className={cn("mb-5", desktopCollapsed && "text-center")}>
              {!desktopCollapsed && (
                <>
                  <div className="text-sm text-ink truncate">{profile.full_name}</div>
                  <div className="eyebrow mt-1">{canManageStudio(profile) ? "Overall Admin" : profile.role}</div>
                </>
              )}
              <button
                type="button"
                onClick={signOut}
                title={desktopCollapsed ? "Sign out" : undefined}
                className={cn(
                  "inline-flex items-center text-xs text-muted-foreground hover:text-ink",
                  desktopCollapsed ? "mt-0 justify-center" : "mt-3 gap-2",
                )}
              >
                <LogOut className="w-3 h-3" /> {!desktopCollapsed && "Sign out"}
              </button>
            </div>
          )}
        </div>
      </aside>

      <header className="lg:hidden fixed top-0 inset-x-0 z-40 bg-background/90 backdrop-blur border-b border-border px-5 h-14 flex items-center justify-between print:hidden">
        <Link to="/" className="font-display text-xl">MERAV Studio</Link>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center border border-border text-ink"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-x-0 top-14 z-40 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-border bg-background/98 px-5 py-5 shadow-sm print:hidden">
          <nav className="grid grid-cols-1 gap-1">
            {nav.map(({ to, label, icon: Icon, exact }) => {
              if (to === "/users" && !canManageStudio(profile)) return null;
              if (to === "/project-management" && isSharedProjectRole(profile?.role)) return null;
              if (to === "/catalog" && !canViewProductCatalog(profile)) return null;
              if (to === "/procurement" && !canViewProcurement(profile)) return null;
              if (to === "/financials" && !canViewFinancials(profile)) return null;
              if (to === "/client/financials" && !isClientRole(profile?.role)) return null;
              if (to === "/hours" && !canLogHours(profile)) return null;
              const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-sm rounded-sm transition-colors",
                    active ? "bg-bone text-ink font-medium" : "text-muted-foreground hover:text-ink hover:bg-bone/60"
                  )}
                >
                  <Icon className="w-[15px] h-[15px] stroke-[1.5]" />
                  {label}
                </Link>
              );
            })}
          </nav>
          {profile && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="text-sm text-ink">{profile.full_name}</div>
              <div className="eyebrow mt-1">{canManageStudio(profile) ? "Overall Admin" : profile.role}</div>
              <button
                type="button"
                onClick={signOut}
                className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-ink"
              >
                <LogOut className="w-3 h-3" /> Sign out
              </button>
            </div>
          )}
        </div>
      )}

      <main className="flex-1 min-w-0 pt-14 lg:pt-0">{children}</main>
      <ReminderNoticeDialog
        open={reminderNoticeOpen}
        reminders={reminderNotices}
        profileId={profile?.id}
        kind={noticeKind}
        onOpenChange={setReminderNoticeOpen}
      />
    </div>
  );
}

function ReminderNoticeDialog({
  open,
  reminders,
  profileId,
  kind,
  onOpenChange,
}: {
  open: boolean;
  reminders: ReminderNotice[];
  profileId?: string;
  kind: NoticeKind;
  onOpenChange: (open: boolean) => void;
}) {
  const markSeen = () => {
    if (typeof window !== "undefined" && profileId && reminders.length) {
      const today = localDateKey();
      const reminderIds = reminders.map((reminder) => reminder.id).sort().join(".");
      const storagePrefix = kind === "todos" ? "merav.shared-todo-notices" : "merav.reminder-notices";
      window.localStorage.setItem(`${storagePrefix}.${profileId}.${today}.${reminderIds}`, "seen");
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) markSeen();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="eyebrow mb-2">{kind === "todos" ? "Project To-Dos" : "Studio Reminders"}</div>
          <DialogTitle className="font-display text-4xl font-normal">
            Items needing attention
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {reminders.map((reminder) => (
            <div key={reminder.id} className="border border-border bg-bone/20 p-4">
              <div className="flex items-start gap-3">
                <Bell className="mt-1 h-4 w-4 shrink-0 text-amber-700" />
                <div className="min-w-0">
                  <div className="font-medium text-ink">{reminder.title}</div>
                  {reminder.project_name && (
                    <div className="mt-1 text-sm text-muted-foreground">{reminder.project_name}</div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {reminder.reminder_date && <span>Reminder: {formatNoticeDate(reminder.reminder_date)}</span>}
                    {reminder.due_date && <span>Due: {formatNoticeDate(reminder.due_date)}</span>}
                  </div>
                  {reminder.notes && (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{reminder.notes}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={markSeen}
          className="mt-2 inline-flex items-center justify-center bg-ink px-5 py-2.5 text-sm text-primary-foreground"
        >
          Got it
        </button>
      </DialogContent>
    </Dialog>
  );
}

function localDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNoticeDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function reminderMatchesProfile(reminder: ReminderNotice, profile: UserProfile | null) {
  const assignee = reminder.assigned_to;
  const email = profile?.email?.toLowerCase() ?? "";
  if (assignee === "ken") return email === "ken@meravinteriors.com";
  if (assignee === "katie") return email === "katie@meravinteriors.com";
  return assignee === "studio";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeout));
  });
}
