import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, type Project } from "@/lib/db";
import { resolveImage } from "@/lib/local-assets";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PRESET_ROOMS, templateForRoomName } from "@/lib/roomTemplates";
import { buildClientProductName } from "@/lib/clientProductName";
import { toast } from "sonner";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — MERAV Studio" },
      { name: "description", content: "Active projects, statuses, and quick access for MERAV Interiors." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await db.listProjects()) ?? [],
  });

  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-12 lg:py-16 max-w-[1500px]">
        <div className="flex items-end justify-between mb-12 lg:mb-16 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">The Studio</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Active Projects</h1>
            <p className="mt-4 text-muted-foreground max-w-xl">
              Every selection lives here once. Use it for presentations, spec books, and procurement.
            </p>
          </div>
          <NewProjectDialog />
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-14">
            {projects.map((p) => <ProjectCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ProjectCard({ p }: { p: Project }) {
  return (
    <Link to="/projects/$id" params={{ id: p.id }} className="group block">
      <div className="aspect-[4/5] bg-bone overflow-hidden mb-5">
        {p.cover_image_url ? (
          <img
            src={resolveImage(p.cover_image_url)}
            alt={p.name}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground font-display text-2xl">
            {p.name.charAt(0)}
          </div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">{p.project_type}</div>
          <h3 className="font-display text-2xl leading-tight truncate">{p.name}</h3>
          <p className="text-sm text-muted-foreground mt-1">{p.client_name}</p>
        </div>
        <StatusBadge status={p.status} />
      </div>
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase text-muted-foreground whitespace-nowrap">
      <span className="w-1 h-1 rounded-full bg-brass" />
      {status}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-border py-24 text-center">
      <div className="eyebrow mb-4">No projects yet</div>
      <p className="font-display text-3xl mb-6">Begin with your first project</p>
      <NewProjectDialog />
    </div>
  );
}

export function NewProjectDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [others, setOthers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (r: string) =>
    setSelected(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);

  const reset = () => {
    setName(""); setClient(""); setNotes(""); setSelected([]); setOthers([]);
  };

  const submit = async () => {
    if (!name.trim() || !client.trim()) return toast.error("Project name and client are required");
    const roomNames = [...selected, ...others.map(o => o.trim()).filter(Boolean)];
    if (roomNames.length === 0) return toast.error("Select at least one room");

    setBusy(true);
    try {
      const p = await db.createProject({
        name: name.trim(),
        client_name: client.trim(),
        project_type: "Whole Home",
        design_notes: notes.trim() || undefined,
      });
      if (!p) throw new Error("Could not create project");

      // Create rooms + seed material_items for each
      for (let i = 0; i < roomNames.length; i++) {
        const rn = roomNames[i];
        const room = await db.createRoom({ project_id: p.id, name: rn });
        if (!room) continue;
        await db.updateRoom(room.id, { sort_order: i });
        const tpl = templateForRoomName(rn);
        if (tpl.length > 0) {
          await db.bulkInsertMaterialItems(
            tpl.map((t, idx) => ({
              room_id: room.id,
              project_id: p.id,
              item_label: t.label,
              client_product_name: buildClientProductName(rn, t.label),
              category: t.category,
              is_required: true,
              sort_order: idx,
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
      }

      toast.success("Project created");
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message || "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 px-6 py-3 bg-ink text-primary-foreground text-sm tracking-wide hover:bg-ink/90 transition-colors">
          <Plus className="w-4 h-4" /> New Project
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="eyebrow">Project Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Montecito Hillside" />
            </div>
            <div className="space-y-1.5">
              <Label className="eyebrow">Client Name</Label>
              <Input value={client} onChange={e => setClient(e.target.value)} placeholder="Smith Family" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Project Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Client priorities, scope, references…" />
          </div>

          <div className="space-y-3">
            <Label className="eyebrow">Rooms in this project</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRESET_ROOMS.map(r => (
                <label key={r} className="flex items-center gap-2 text-sm cursor-pointer py-1.5 px-2 hover:bg-bone/60 rounded-sm">
                  <Checkbox checked={selected.includes(r)} onCheckedChange={() => toggle(r)} />
                  <span>{r}</span>
                </label>
              ))}
            </div>

            {others.map((val, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={val}
                  onChange={e => setOthers(o => o.map((x, i) => i === idx ? e.target.value : x))}
                  placeholder="Custom room name (e.g. Pantry, Mudroom)"
                />
                <button
                  type="button"
                  onClick={() => setOthers(o => o.filter((_, i) => i !== idx))}
                  className="text-muted-foreground hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOthers(o => [...o, ""])}
              className="text-xs text-muted-foreground hover:text-ink underline-offset-4 hover:underline"
            >
              + Add other room
            </button>
          </div>

          <button onClick={submit} disabled={busy} className="w-full mt-2 py-3 bg-ink text-primary-foreground text-sm tracking-wide disabled:opacity-60">
            {busy ? "Creating…" : "Create Project"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
