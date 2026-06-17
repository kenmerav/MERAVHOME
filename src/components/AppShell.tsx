import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, FolderOpen, LayoutTemplate, Truck, Library, BookOpen, UserCog, LogOut, DollarSign, Menu, X, Clock, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { UserProfile } from "@/lib/db";
import { canLogHours, canViewFinancials, canViewProcurement } from "@/lib/permissions";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/catalog", label: "Product Catalog", icon: Library },
  { to: "/presentations", label: "Presentation Boards", icon: LayoutTemplate },
  { to: "/specbooks", label: "Spec Books", icon: BookOpen },
  { to: "/procurement", label: "Procurement", icon: Truck },
  { to: "/financials", label: "Financials", icon: DollarSign },
  { to: "/hours", label: "Hours", icon: Clock },
  { to: "/users", label: "Users", icon: UserCog },
];


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
    if (!loadingAuth && (loc.pathname.startsWith("/procurement") || loc.pathname.startsWith("/financials") || loc.pathname.includes("/financials")) && !canViewFinancials(profile)) {
      navigate({ to: "/" });
    }
  }, [loadingAuth, loc.pathname, navigate, profile]);

  useEffect(() => {
    if (!loadingAuth && profile?.role === "Client" && loc.pathname.startsWith("/catalog")) {
      navigate({ to: "/" });
    }
  }, [loadingAuth, loc.pathname, navigate, profile]);

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
            if (to === "/users" && !profile?.is_owner) return null;
            if (to === "/catalog" && profile?.role === "Client") return null;
            if (to === "/procurement" && !canViewProcurement(profile)) return null;
            if (to === "/financials" && !canViewFinancials(profile)) return null;
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
                  <div className="eyebrow mt-1">{profile.is_owner ? "Overall Admin" : profile.role}</div>
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
              if (to === "/users" && !profile?.is_owner) return null;
              if (to === "/catalog" && profile?.role === "Client") return null;
              if (to === "/procurement" && !canViewProcurement(profile)) return null;
              if (to === "/financials" && !canViewFinancials(profile)) return null;
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
              <div className="eyebrow mt-1">{profile.is_owner ? "Overall Admin" : profile.role}</div>
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
    </div>
  );
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
