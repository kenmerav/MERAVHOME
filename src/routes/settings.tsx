import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — MERAV Studio" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const studio = [
    { label: "Studio Name", value: "MERAV Interiors" },
    { label: "Use", value: "Internal — designers & design assistants" },
    { label: "Primary Output", value: "Presentations, spec books, procurement" },
  ];
  const future = [
    { t: "Client Portal", d: "Share approved selections with clients for review." },
    { t: "Alcove Integration", d: "Pull and sync product data directly from Alcove." },
    { t: "QuickBooks Integration", d: "Sync vendor invoices and procurement spend." },
    { t: "Purchase Orders", d: "Generate POs from procurement items in one click." },
    { t: "Installation Scheduling", d: "Coordinate trades against received items." },
  ];
  return (
    <AppShell>
      <div className="page-pad max-w-[1100px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Studio</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl">Settings</h1>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-20">
          {studio.map(s => (
            <div key={s.label} className="border border-border p-6">
              <div className="eyebrow mb-2">{s.label}</div>
              <div className="font-display text-xl">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="eyebrow mb-6 flex items-center gap-2"><Sparkles className="w-3 h-3" /> Coming Soon</div>
        <div className="space-y-4">
          {future.map(f => (
            <div key={f.t} className="flex items-start justify-between gap-8 border-b border-border pb-5">
              <div>
                <h3 className="font-display text-2xl mb-1">{f.t}</h3>
                <p className="text-sm text-muted-foreground">{f.d}</p>
              </div>
              <span className="eyebrow shrink-0">Planned</span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
