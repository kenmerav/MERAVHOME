import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Printer, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, type MaterialItem, type Room } from "@/lib/db";
import { ALL_CATEGORIES } from "@/lib/roomTemplates";

export const Route = createFileRoute("/specbooks/$id")({
  head: () => ({ meta: [{ title: "Spec Book — MERAV Studio" }] }),
  component: SpecBookPage,
});

// Spec-book section ordering per room type. Each section maps to one or more
// material_items.category values. Items whose category doesn't match anything
// fall into a trailing "Other" group.
type Section = { label: string; sources: string[] };

const KITCHEN_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Plumbing", sources: ["Plumbing"] },
  { label: "Countertops + Tile", sources: ["Countertops", "Tile & Stone"] },
  { label: "Cabinetry + Hardware", sources: ["Cabinetry & Hardware"] },
  { label: "Flooring + Paint", sources: ["Flooring & Paint"] },
];
const BATHROOM_SECTIONS: Section[] = [
  { label: "Tile + Stone", sources: ["Tile & Stone", "Countertops"] },
  { label: "Plumbing", sources: ["Plumbing"] },
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Cabinetry + Hardware", sources: ["Cabinetry & Hardware"] },
  { label: "Flooring + Paint", sources: ["Flooring & Paint"] },
  { label: "Accessories", sources: ["Accessories"] },
];
const BEDROOM_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Flooring + Paint", sources: ["Flooring & Paint"] },
];
const LIVING_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Tile", sources: ["Tile & Stone"] },
  { label: "Flooring + Paint", sources: ["Flooring & Paint"] },
];
const DEFAULT_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Plumbing", sources: ["Plumbing"] },
  { label: "Tile + Stone", sources: ["Tile & Stone", "Countertops"] },
  { label: "Cabinetry + Hardware", sources: ["Cabinetry & Hardware"] },
  { label: "Flooring + Paint", sources: ["Flooring & Paint"] },
  { label: "Accessories", sources: ["Accessories"] },
];

function sectionsForRoom(name: string): Section[] {
  const n = name.trim().toLowerCase();
  if (n === "kitchen") return KITCHEN_SECTIONS;
  if (n.includes("bath")) return BATHROOM_SECTIONS;
  if (n.includes("bedroom") || n === "office") return BEDROOM_SECTIONS;
  if (n === "living room" || n === "dining room") return LIVING_SECTIONS;
  return DEFAULT_SECTIONS;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function SpecBookPage() {
  const [view, setView] = useState<"room" | "category">("room");

  const { id } = Route.useParams();
  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => db.getProject(id) });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", id], queryFn: async () => (await db.listRooms(id)) ?? [] });
  const { data: items = [] } = useQuery({
    queryKey: ["materialItems", id],
    queryFn: async () => (await db.listMaterialItemsByProject(id)) ?? [],
  });

  const byRoom = useMemo(() => {
    const map = new Map<string, MaterialItem[]>();
    items.forEach((it) => {
      if (it.not_needed) return;
      if (!it.product_id || !it.product) return;
      const arr = map.get(it.room_id) ?? [];
      arr.push(it);
      map.set(it.room_id, arr);
    });
    return map;
  }, [items]);

  if (!project) return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;

  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const populatedRooms = rooms.filter((r) => (byRoom.get(r.id) ?? []).length > 0);

  return (
    <AppShell>
      <div className="px-8 lg:px-14 py-8 print:p-0 bg-white text-ink">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <Link to="/projects/$id/materials" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink">
            <ArrowLeft className="w-3.5 h-3.5" /> Materials
          </Link>
          <div className="flex items-center gap-4">
            <div className="inline-flex border border-border text-xs tracking-[0.18em] uppercase">
              <button
                onClick={() => setView("room")}
                className={`px-4 py-2 ${view === "room" ? "bg-ink text-primary-foreground" : "text-muted-foreground hover:text-ink"}`}
              >
                By Room
              </button>
              <button
                onClick={() => setView("category")}
                className={`px-4 py-2 border-l border-border ${view === "category" ? "bg-ink text-primary-foreground" : "text-muted-foreground hover:text-ink"}`}
              >
                By Category
              </button>
            </div>
            <Link to="/projects/$id/presentation" params={{ id }} className="text-sm text-muted-foreground hover:text-ink underline-offset-4 hover:underline">
              View Presentation
            </Link>
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-primary-foreground text-sm">
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
          </div>
        </div>

        {/* COVER */}
        <section className="border border-border bg-white p-16 lg:p-24 mb-10 print:border-0 print:break-after-page min-h-[85vh] flex flex-col justify-between">
          <div className="eyebrow">MERAV Studio · Specification Book</div>
          <div>
            <h1 className="font-display text-5xl lg:text-7xl leading-[1.05]">{project.name}</h1>
            <p className="font-display text-2xl text-muted-foreground mt-6">{project.client_name}</p>
          </div>
          <div className="flex items-end justify-between text-xs tracking-[0.2em] uppercase text-muted-foreground">
            <div>{today}</div>
            <div>{project.status}</div>
          </div>
        </section>

        {/* TABLE OF CONTENTS */}
        <section className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-after-page">
          <div className="eyebrow mb-3">Contents</div>
          <h2 className="font-display text-4xl mb-10">Table of Contents</h2>
          <ol className="space-y-3 text-lg max-w-xl">
            <TocRow num="01" label="Materials Overview" href="#materials-overview" />
            {view === "room"
              ? populatedRooms.map((r, i) => (
                  <TocRow key={r.id} num={String(i + 2).padStart(2, "0")} label={r.name} href={`#room-${slug(r.name)}-${r.id.slice(0, 6)}`} />
                ))
              : ALL_CATEGORIES.filter((c) => items.some((it) => !it.not_needed && it.product_id && it.product && it.category === c))
                  .map((c, i) => (
                    <TocRow key={c} num={String(i + 2).padStart(2, "0")} label={c} href={`#cat-${slug(c)}`} />
                  ))}
          </ol>
        </section>

        {/* MATERIALS OVERVIEW */}
        <section id="materials-overview" className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-after-page">
          <div className="eyebrow mb-3">01 · Overview</div>
          <h2 className="font-display text-4xl mb-10">Materials Overview</h2>
          {populatedRooms.length === 0 ? (
            <p className="text-muted-foreground italic">No products selected yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="eyebrow font-normal py-3 pr-4">Room</th>
                  <th className="eyebrow font-normal py-3 pr-4">Category</th>
                  <th className="eyebrow font-normal py-3 pr-4">Product</th>
                  <th className="eyebrow font-normal py-3 pr-4">Vendor</th>
                  <th className="eyebrow font-normal py-3 pr-4">Qty</th>
                </tr>
              </thead>
              <tbody>
                {populatedRooms.flatMap((room) => {
                  const list = byRoom.get(room.id) ?? [];
                  return list.map((it) => (
                    <tr key={it.id} className="border-b border-border/60 align-top">
                      <td className="py-3 pr-4 font-display">{room.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{it.category || "—"}</td>
                      <td className="py-3 pr-4">{it.product?.name || "—"}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{it.product?.vendor || "—"}</td>
                      <td className="py-3 pr-4">{it.quantity ?? "—"}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* BODY */}
        {view === "room"
          ? populatedRooms.map((room, idx) => (
              <RoomSpec
                key={room.id}
                num={String(idx + 2).padStart(2, "0")}
                room={room}
                items={byRoom.get(room.id) ?? []}
                projectName={project.name}
              />
            ))
          : (() => {
              const rooms = populatedRooms;
              const roomById = new Map(rooms.map((r) => [r.id, r] as const));
              const visibleItems = items.filter((it) => !it.not_needed && it.product_id && it.product);
              return ALL_CATEGORIES.map((cat) => {
                const list = visibleItems.filter((it) => it.category === cat);
                if (list.length === 0) return null;
                return (
                  <CategorySpec
                    key={cat}
                    category={cat}
                    items={list}
                    roomById={roomById}
                    projectName={project.name}
                  />
                );
              });
            })()}
      </div>
    </AppShell>
  );
}

function TocRow({ num, label, href }: { num: string; label: string; href: string }) {
  return (
    <li>
      <a href={href} className="flex items-baseline gap-4 hover:text-ink text-muted-foreground">
        <span className="eyebrow text-ink">{num}</span>
        <span className="flex-1 border-b border-dotted border-border/70 translate-y-[-4px]" />
        <span className="font-display text-ink">{label}</span>
      </a>
    </li>
  );
}

function CategorySpec({
  category,
  items,
  roomById,
  projectName,
}: {
  category: string;
  items: MaterialItem[];
  roomById: Map<string, Room>;
  projectName: string;
}) {
  const byRoom = useMemo(() => {
    const map = new Map<string, MaterialItem[]>();
    items.forEach((it) => {
      const arr = map.get(it.room_id) ?? [];
      arr.push(it);
      map.set(it.room_id, arr);
    });
    return Array.from(map.entries())
      .map(([rid, list]) => ({ room: roomById.get(rid), list }))
      .filter((g) => g.room);
  }, [items, roomById]);

  return (
    <section
      id={`cat-${slug(category)}`}
      className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-before-page"
    >
      <div className="flex items-baseline justify-between mb-12 pb-6 border-b border-border">
        <div>
          <div className="eyebrow">{projectName} · Category</div>
          <h2 className="font-display text-5xl mt-2">{category}</h2>
        </div>
        <div className="text-xs tracking-wide text-muted-foreground">
          {items.length} selection{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-14">
        {byRoom.map(({ room, list }) => (
          <div key={room!.id}>
            <div className="eyebrow mb-6">{room!.name}</div>
            <div className="space-y-10">
              {list.map((it) => <SpecCard key={it.id} item={it} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoomSpec({ num, room, items, projectName }: { num: string; room: Room; items: MaterialItem[]; projectName: string }) {
  const sections = sectionsForRoom(room.name);
  const grouped = useMemo(() => {
    const used = new Set<string>();
    const out = sections.map((sec) => {
      const list = items.filter((it) => it.category && sec.sources.includes(it.category));
      list.forEach((it) => used.add(it.id));
      return { label: sec.label, list };
    }).filter((g) => g.list.length > 0);
    const leftover = items.filter((it) => !used.has(it.id));
    if (leftover.length > 0) out.push({ label: "Other", list: leftover });
    return out;
  }, [items, sections]);

  return (
    <section
      id={`room-${slug(room.name)}-${room.id.slice(0, 6)}`}
      className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-before-page"
    >
      <div className="flex items-baseline justify-between mb-12 pb-6 border-b border-border">
        <div>
          <div className="eyebrow">{num} · {projectName}</div>
          <h2 className="font-display text-5xl mt-2">{room.name}</h2>
        </div>
        <div className="text-xs tracking-wide text-muted-foreground">
          {items.length} selection{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-14">
        {grouped.map((g) => (
          <div key={g.label}>
            <div className="eyebrow mb-6">{g.label}</div>
            <div className="space-y-10">
              {g.list.map((it) => <SpecCard key={it.id} item={it} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SpecCard({ item }: { item: MaterialItem }) {
  const p = item.product;
  return (
    <article className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 pb-10 border-b border-border last:border-0 print:break-inside-avoid">
      <div className="aspect-square bg-bone overflow-hidden">
        {p?.image_url ? (
          <img src={p.image_url} alt={p?.name ?? item.item_label} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full grid place-items-center text-muted-foreground font-display text-4xl">
            {item.item_label.charAt(0)}
          </div>
        )}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-4 mb-1">
          <div className="eyebrow">{item.item_label}</div>
          {item.cad_label && (
            <span className="text-[10px] tracking-[0.18em] uppercase px-2 py-0.5 border border-border">{item.cad_label}</span>
          )}
        </div>
        <h3 className="font-display text-3xl leading-tight">{p?.name || "—"}</h3>
        {p?.vendor && <p className="text-sm text-muted-foreground mt-1 tracking-wide">{p.vendor}</p>}

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm mt-6">
          <Detail label="Finish" value={p?.finish} />
          <Detail label="Color" value={item.color} />
          <Detail label="SKU" value={p?.sku} />
          <Detail label="Dimensions" value={p?.dimensions} />
          <Detail label="CAD Label" value={item.cad_label} />
          <Detail label="Quantity" value={item.quantity != null ? String(item.quantity) : null} />
        </dl>

        {p?.product_url && (
          <div className="mt-5">
            <dt className="eyebrow mb-1">Product URL</dt>
            <a
              href={p.product_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs break-all underline inline-flex items-start gap-1"
            >
              {p.product_url} <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
            </a>
          </div>
        )}

        {item.notes && (
          <div className="mt-5">
            <dt className="eyebrow mb-1">Notes</dt>
            <p className="text-sm text-muted-foreground italic leading-relaxed">{item.notes}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
