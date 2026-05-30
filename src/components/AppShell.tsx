import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, FolderOpen, LayoutTemplate, Truck, Settings, Sparkles, Library, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/catalog", label: "Product Catalog", icon: Library },
  { to: "/presentations", label: "Presentation Boards", icon: LayoutTemplate },
  { to: "/specbooks", label: "Spec Books", icon: BookOpen },
  { to: "/procurement", label: "Procurement", icon: Truck },
  { to: "/settings", label: "Settings", icon: Settings },
];


export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-sidebar sticky top-0 h-screen print:hidden">
        <div className="px-7 pt-8 pb-10">
          <Link to="/" className="block">
            <div className="font-display text-2xl tracking-tight leading-none">MERAV</div>
            <div className="eyebrow mt-1.5">Studio</div>
          </Link>
        </div>
        <nav className="flex-1 px-3 space-y-0.5">
          {nav.map(({ to, label, icon: Icon, exact }) => {
            const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 text-sm rounded-sm transition-colors",
                  active ? "bg-bone text-ink font-medium" : "text-muted-foreground hover:text-ink hover:bg-bone/60"
                )}
              >
                <Icon className="w-[15px] h-[15px] stroke-[1.5]" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="px-7 py-6 border-t border-border">
          <div className="eyebrow mb-3 flex items-center gap-2"><Sparkles className="w-3 h-3" /> Coming Soon</div>
          <ul className="space-y-1.5 text-[13px] text-muted-foreground">
            <li>Client Portal</li>
            <li>AI Rendering Engine</li>
            <li>QuickBooks Sync</li>
            <li>Purchase Orders</li>
          </ul>
        </div>
      </aside>

      <header className="lg:hidden fixed top-0 inset-x-0 z-40 bg-background/90 backdrop-blur border-b border-border px-5 h-14 flex items-center">
        <Link to="/" className="font-display text-xl">MERAV Studio</Link>
      </header>

      <main className="flex-1 min-w-0 pt-14 lg:pt-0">{children}</main>
    </div>
  );
}
