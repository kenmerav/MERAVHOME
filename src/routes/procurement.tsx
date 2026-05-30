import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/procurement")({
  head: () => ({ meta: [{ title: "Procurement — MERAV Studio" }] }),
  component: ProcurementPage,
});

function ProcurementPage() {
  const qc = useQueryClient();
  const [projectFilter, setProjectFilter] = useState("__overall");
  const { data: items = [] } = useQuery({
    queryKey: ["procurement"],
    queryFn: async () => (await db.listProcurement()) ?? [],
  });
  const projectOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; client_name: string; status: string }>();
    items.forEach((item) => {
      const project = item.room_product?.room?.project;
      if (project?.id) map.set(project.id, project);
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.status === "Complete" && b.status !== "Complete") return 1;
      if (a.status !== "Complete" && b.status === "Complete") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [items]);
  const visibleItems = projectFilter === "__overall"
    ? items
    : items.filter((item) => item.room_product?.room?.project?.id === projectFilter);

  const toggle = async (id: string, key: "ordered" | "received" | "installed", value: boolean) => {
    await db.updateProcurement(id, { [key]: value });
    qc.invalidateQueries({ queryKey: ["procurement"] });
  };

  const total = visibleItems.length;
  const ordered = visibleItems.filter(i => i.ordered).length;
  const received = visibleItems.filter(i => i.received).length;
  const installed = visibleItems.filter(i => i.installed).length;

  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-12 lg:py-16 max-w-[1700px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Workflow</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl">Procurement</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Everything needed to place an order — product, vendor, link, quantity, color, dimensions, and pricing.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <Stat label="Total Items" n={total} />
          <Stat label="Ordered" n={ordered} total={total} />
          <Stat label="Received" n={received} total={total} />
          <Stat label="Installed" n={installed} total={total} />
        </div>

        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div className="min-w-[280px]">
            <label className="eyebrow block mb-2">Project</label>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="h-10 w-full border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="__overall">Overall · All Projects</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.client_name}{project.status === "Complete" ? " · Archived" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground pb-2">
            Room, category, and vendor filters are next; this starts procurement as project-based with an overall view.
          </div>
        </div>

        <div className="border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border bg-bone/30">
                <th className="px-3 py-3 min-w-[240px]">Client Product Name</th>
                <th className="px-3 py-3">Vendor</th>
                <th className="px-3 py-3">Link</th>
                <th className="px-3 py-3 text-center w-[60px]">Qty</th>
                <th className="px-3 py-3">Color</th>
                <th className="px-3 py-3">Dimensions</th>
                <th className="px-3 py-3 text-right">Client Price</th>
                <th className="px-3 py-3 text-right">Unit Cost</th>
                <th className="px-3 py-3">Project · Room</th>
                <th className="px-3 py-3 text-center w-[70px]">Ordered</th>
                <th className="px-3 py-3 text-center w-[70px]">Received</th>
                <th className="px-3 py-3 text-center w-[70px]">Installed</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 && (
                <tr><td colSpan={12} className="py-20 text-center text-sm text-muted-foreground">
                  No procurement items for this view yet. Add products to a room to populate.
                </td></tr>
              )}
              {visibleItems.map(item => {
                const p = item.room_product?.product;
                const r = item.room_product?.room;
                const m = (item as any).material as { client_product_name: string | null; quantity: number | null; color: string | null; product_url: string | null; cad_label: string | null } | null;
                const link = m?.product_url || p?.product_url || null;
                const clientName = m?.client_product_name || [r?.name, p?.category].filter(Boolean).join(" ") || p?.name || "—";
                return (
                  <tr key={item.id} className="border-b border-border align-top">
                    <td className="px-3 py-3">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 bg-bone overflow-hidden flex-shrink-0 border border-border">
                          {p?.image_url && <img src={p.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
                        </div>
                        <div className="min-w-0">
                          <div className="font-display text-base leading-tight truncate max-w-[220px]" title={clientName}>{clientName}</div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                            {[p?.name, m?.cad_label, p?.sku && `SKU ${p.sku}`].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">{p?.vendor || "—"}</td>
                    <td className="px-3 py-3 text-xs">
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:underline">
                          Order <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center font-display text-base">{m?.quantity ?? "—"}</td>
                    <td className="px-3 py-3 text-xs">{m?.color || p?.finish || "—"}</td>
                    <td className="px-3 py-3 text-xs">{p?.dimensions || "—"}</td>
                    <td className="px-3 py-3 text-right text-xs">{p?.price || "—"}</td>
                    <td className="px-3 py-3 text-right text-xs">{p?.unit_cost || "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <div className="truncate max-w-[140px]">{r?.project?.name}</div>
                      <div className="text-ink truncate max-w-[140px]">{r?.name}</div>
                    </td>
                    {(["ordered","received","installed"] as const).map(k => (
                      <td key={k} className="px-3 py-3">
                        <div className="flex justify-center">
                          <button
                            onClick={() => toggle(item.id, k, !item[k])}
                            className={cn(
                              "w-6 h-6 border flex items-center justify-center transition-colors",
                              item[k] ? "bg-ink border-ink text-primary-foreground" : "border-border hover:border-ink"
                            )}
                          >
                            {item[k] && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
                          </button>
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, n, total }: { label: string; n: number; total?: number }) {
  const pct = total ? Math.round((n / total) * 100) : null;
  return (
    <div className="border border-border p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="font-display text-4xl">{n}</div>
        {pct !== null && <div className="text-xs text-muted-foreground">{pct}%</div>}
      </div>
      {total !== undefined && (
        <div className="mt-3 h-px bg-border relative">
          <div className="absolute inset-y-0 left-0 bg-brass" style={{ width: `${pct ?? 0}%`, height: 1 }} />
        </div>
      )}
    </div>
  );
}
