import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Printer, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  db,
  SUBCATEGORIES,
  type MaterialItem,
  type Product,
  type ProductCategory,
  type Room,
} from "@/lib/db";
import { ALL_CATEGORIES, normalizeItemCategory, toProductCategory } from "@/lib/roomTemplates";
import { clientProductName } from "@/lib/clientProductName";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, moneyValue, normalizeMoneyInput } from "@/lib/money";
import { toast } from "sonner";
import { canViewProjectSurface, specBookVisibilityForRole } from "@/lib/permissions";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { materialImageUrl } from "@/lib/materialImages";

export const Route = createFileRoute("/specbooks/$id")({
  head: () => ({ meta: [{ title: "Spec Book — MERAV Studio" }] }),
  component: SpecBookPage,
});

// Spec-book section ordering per room type. Each section maps to one or more
// material_items.category values. Items whose category doesn't match anything
// fall into a trailing "Other" group.
type Section = { label: string; sources: string[] };
type SpecJumpItem = { id: string; label: string };

function externalHref(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!/\s/.test(trimmed) && /^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

const KITCHEN_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Plumbing", sources: ["Plumbing"] },
  { label: "Countertops", sources: ["Countertops"] },
  { label: "Tile + Stone", sources: ["Tile & Stone"] },
  { label: "Cabinetry", sources: ["Cabinetry", "Cabinetry & Hardware"] },
  { label: "Hardware", sources: ["Hardware"] },
  { label: "Flooring + Paint", sources: ["Flooring", "Paint", "Flooring & Paint"] },
];
const BATHROOM_SECTIONS: Section[] = [
  { label: "Countertops", sources: ["Countertops"] },
  { label: "Tile + Stone", sources: ["Tile & Stone"] },
  { label: "Plumbing", sources: ["Plumbing"] },
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Cabinetry", sources: ["Cabinetry", "Cabinetry & Hardware"] },
  { label: "Hardware", sources: ["Hardware"] },
  { label: "Flooring + Paint", sources: ["Flooring", "Paint", "Flooring & Paint"] },
  { label: "Accessories", sources: ["Accessories"] },
];
const BEDROOM_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Flooring + Paint", sources: ["Flooring", "Paint", "Flooring & Paint"] },
];
const LIVING_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Countertops", sources: ["Countertops"] },
  { label: "Tile + Stone", sources: ["Tile & Stone"] },
  { label: "Hardware", sources: ["Hardware"] },
  { label: "Flooring + Paint", sources: ["Flooring", "Paint", "Flooring & Paint"] },
];
const DEFAULT_SECTIONS: Section[] = [
  { label: "Lighting", sources: ["Lighting"] },
  { label: "Plumbing", sources: ["Plumbing"] },
  { label: "Countertops", sources: ["Countertops"] },
  { label: "Tile + Stone", sources: ["Tile & Stone"] },
  { label: "Cabinetry", sources: ["Cabinetry", "Cabinetry & Hardware"] },
  { label: "Hardware", sources: ["Hardware"] },
  { label: "Flooring + Paint", sources: ["Flooring", "Paint", "Flooring & Paint"] },
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
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function scrollToSpecSection(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function formatLastUpdated(value: string | null | undefined) {
  if (!value) return "Not updated yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function latestTimestamp(values: Array<string | null | undefined>) {
  let latest = 0;
  let latestValue: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isNaN(time) && time > latest) {
      latest = time;
      latestValue = value;
    }
  }
  return latestValue;
}

function SpecBookPage() {
  const { id } = Route.useParams();
  return (
    <AppShell>
      <SpecBookDocument projectId={id} />
    </AppShell>
  );
}

export function SpecBookDocument({
  projectId: id,
  publicView = false,
}: {
  projectId: string;
  publicView?: boolean;
}) {
  const [view, setView] = useState<"room" | "category">("room");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [jumpTarget, setJumpTarget] = useState("");
  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const { data: profile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
    enabled: !publicView,
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", id],
    queryFn: async () => (await db.listRooms(id)) ?? [],
  });
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

  if (!project) return <div className="p-16 text-muted-foreground">Loading…</div>;

  if (!publicView && profile && !canViewProjectSurface(profile, project, "specBook")) {
    return (
      <div className="p-16">
        <div className="eyebrow">Spec Book</div>
        <h1 className="mt-3 font-display text-5xl">Not ready to view yet</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
          This spec book is not currently shared for your role on this project.
        </p>
      </div>
    );
  }

  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const populatedRooms = rooms.filter((r) => (byRoom.get(r.id) ?? []).length > 0);
  const jumpItems = useMemo<SpecJumpItem[]>(() => {
    const base = [
      { id: "table-of-contents", label: "Table of Contents" },
      { id: "materials-overview", label: "Materials Overview" },
    ];
    if (view === "room") {
      return [
        ...base,
        ...populatedRooms.map((room) => ({
          id: `room-${slug(room.name)}-${room.id.slice(0, 6)}`,
          label: room.name,
        })),
      ];
    }
    return [
      ...base,
      ...ALL_CATEGORIES.filter((category) =>
        items.some(
          (item) =>
            !item.not_needed &&
            item.product_id &&
            item.product &&
            normalizeItemCategory(item.category) === category,
        ),
      ).map((category) => ({ id: `cat-${slug(category)}`, label: category })),
    ];
  }, [items, populatedRooms, view]);

  const jumpToSection = (sectionId: string) => {
    setJumpTarget(sectionId);
    scrollToSpecSection(sectionId);
  };

  const returnToTop = () => {
    jumpToSection("table-of-contents");
  };
  const canEditProducts =
    !publicView &&
    profile?.is_active === true &&
    (profile.role === "Admin" || profile.role === "Employee");
  const isSharedSpecView =
    publicView || profile?.role === "Client" || profile?.role === "Contractor";
  const visibility = publicView
    ? { showPricing: true, showLinks: true, showOrdering: true }
    : specBookVisibilityForRole(profile, project);
  const specBookUrl = `https://studio.meravinteriors.com/specbooks/public/${id}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&format=svg&data=${encodeURIComponent(
    specBookUrl,
  )}`;
  const lastUpdatedAt = latestTimestamp([
    project.updated_at,
    ...rooms.map((room) => room.updated_at),
    ...items.flatMap((item) => [item.updated_at, item.product?.updated_at]),
  ]);

  return (
      <div className={`page-pad print:p-0 bg-white text-ink ${publicView ? "max-w-[1500px] mx-auto" : ""}`}>
        <div className="print:hidden fixed bottom-6 right-6 z-40 hidden items-center gap-2 rounded-full border border-border bg-white/95 p-2 shadow-lg backdrop-blur md:flex">
          <SpecJumpSelect
            items={jumpItems}
            value={jumpTarget}
            onJump={jumpToSection}
            compact
            className="w-[230px]"
          />
          <button
            type="button"
            onClick={returnToTop}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink text-primary-foreground hover:bg-ink/90"
            title="Return to top"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center justify-between mb-8 print:hidden">
          {publicView ? (
            <div className="eyebrow">MERAV Studio · Public Spec Book</div>
          ) : (
            <Link
              to="/projects/$id/materials"
              params={{ id }}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Materials
            </Link>
          )}
          <div className="flex items-center gap-4">
            <SpecJumpSelect
              items={jumpItems}
              value={jumpTarget}
              onJump={jumpToSection}
              className="w-[240px]"
            />
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
            {!publicView && (
              <Link
                to="/projects/$id/presentation"
                params={{ id }}
                className="text-sm text-muted-foreground hover:text-ink underline-offset-4 hover:underline"
              >
                View Presentation
              </Link>
            )}
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-primary-foreground text-sm"
            >
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
          </div>
        </div>

        {/* COVER */}
        <section className="border border-border bg-white p-16 lg:p-24 mb-10 print:border-0 print:break-after-page min-h-[85vh] flex flex-col justify-between print:min-h-[95vh] print:px-16 print:py-18">
          <div className="eyebrow">MERAV Studio · Specification Book</div>
          <div className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground print:text-[10px]">
            Last updated {formatLastUpdated(lastUpdatedAt)}
          </div>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end print:grid-cols-[minmax(0,1fr)_180px] print:gap-10">
            <div>
              <h1 className="font-display text-5xl lg:text-7xl leading-[1.05] print:text-6xl">
                {project.name}
              </h1>
              <p className="font-display text-2xl text-muted-foreground mt-6 print:text-xl">
                {project.client_name}
              </p>
            </div>
            <div className="border border-border px-5 py-5 bg-bone/35 print:px-4 print:py-4">
              <img
                src={qrCodeUrl}
                alt="QR code linking to the online spec book"
                className="w-full h-auto"
                loading="eager"
              />
              <div className="mt-4 text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                View Online
              </div>
              <a
                href={specBookUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-[11px] break-all text-ink underline print:no-underline"
              >
                {specBookUrl}
              </a>
            </div>
          </div>
          <div className="flex items-end justify-between text-xs tracking-[0.2em] uppercase text-muted-foreground">
            <div>{today}</div>
            <div>{project.status}</div>
          </div>
        </section>

        {/* TABLE OF CONTENTS */}
        <section
          id="table-of-contents"
          className="scroll-mt-8 border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-after-page"
        >
          <div className="eyebrow mb-3">Contents</div>
          <h2 className="font-display text-4xl mb-10">Table of Contents</h2>
          <ol className="space-y-3 text-lg max-w-xl">
            <TocRow num="01" label="Materials Overview" href="#materials-overview" />
            {view === "room"
              ? populatedRooms.map((r, i) => (
                  <TocRow
                    key={r.id}
                    num={String(i + 2).padStart(2, "0")}
                    label={r.name}
                    href={`#room-${slug(r.name)}-${r.id.slice(0, 6)}`}
                  />
                ))
              : ALL_CATEGORIES.filter((c) =>
                  items.some(
                    (it) => !it.not_needed && it.product_id && it.product && normalizeItemCategory(it.category) === c,
                  ),
                ).map((c, i) => (
                  <TocRow
                    key={c}
                    num={String(i + 2).padStart(2, "0")}
                    label={c}
                    href={`#cat-${slug(c)}`}
                  />
                ))}
          </ol>
        </section>

        {/* MATERIALS OVERVIEW */}
        <section
          id="materials-overview"
          className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-after-page"
        >
          <div className="flex items-start justify-between gap-6 mb-6">
            <div>
              <div className="eyebrow mb-3">01 · Overview</div>
              <h2 className="font-display text-4xl">Materials Overview</h2>
            </div>
            <button
              type="button"
              onClick={() => setOverviewOpen((current) => !current)}
              className="print:hidden inline-flex items-center gap-2 px-4 py-2 border border-border text-xs tracking-[0.18em] uppercase text-muted-foreground hover:text-ink"
            >
              {overviewOpen ? "Collapse" : "Expand"}
              <ChevronDown
                className={`w-4 h-4 transition-transform ${overviewOpen ? "rotate-180" : ""}`}
              />
            </button>
          </div>
          <div className={`${overviewOpen ? "block" : "hidden"} print:block`}>
            {populatedRooms.length === 0 ? (
              <p className="text-muted-foreground italic">No products selected yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="eyebrow font-normal py-3 pr-4">Room</th>
                    <th className="eyebrow font-normal py-3 pr-4">Category</th>
                    <th className="eyebrow font-normal py-3 pr-4">Client Product Name</th>
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
                        <td className="py-3 pr-4 text-muted-foreground">{normalizeItemCategory(it.category) ?? it.category ?? "—"}</td>
                        <td className="py-3 pr-4">
                          <div>{clientProductName(it, room)}</div>
                          {!isSharedSpecView && actualProductName(it, room) && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {actualProductName(it, room)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {it.product?.vendor || "—"}
                        </td>
                        <td className="py-3 pr-4">{it.quantity ?? "—"}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            )}
          </div>
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
                projectId={id}
                canEditProducts={canEditProducts}
                showLinks={visibility.showLinks}
                showPricing={visibility.showPricing}
                showOrdering={visibility.showOrdering}
                hideInternalProductDetails={isSharedSpecView}
              />
            ))
          : (() => {
              const rooms = populatedRooms;
              const roomById = new Map(rooms.map((r) => [r.id, r] as const));
              const visibleItems = items.filter(
                (it) => !it.not_needed && it.product_id && it.product,
              );
              return ALL_CATEGORIES.map((cat) => {
                const list = visibleItems.filter((it) => normalizeItemCategory(it.category) === cat);
                if (list.length === 0) return null;
                return (
                  <CategorySpec
                    key={cat}
                    category={cat}
                    items={list}
                    roomById={roomById}
                    projectName={project.name}
                    projectId={id}
                    canEditProducts={canEditProducts}
                    showLinks={visibility.showLinks}
                    showPricing={visibility.showPricing}
                    showOrdering={visibility.showOrdering}
                    hideInternalProductDetails={isSharedSpecView}
                  />
                );
              });
            })()}
      </div>
  );
}

function SpecJumpSelect({
  items,
  value,
  onJump,
  compact = false,
  className = "",
}: {
  items: SpecJumpItem[];
  value: string;
  onJump: (sectionId: string) => void;
  compact?: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <Select value={value || undefined} onValueChange={onJump}>
      <SelectTrigger className={`${compact ? "h-10 rounded-full" : "h-10"} border-border bg-white text-sm ${className}`}>
        <SelectValue placeholder="Jump to" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  projectId,
  canEditProducts,
  showLinks,
  showPricing,
  showOrdering,
  hideInternalProductDetails,
}: {
  category: string;
  items: MaterialItem[];
  roomById: Map<string, Room>;
  projectName: string;
  projectId: string;
  canEditProducts: boolean;
  showLinks: boolean;
  showPricing: boolean;
  showOrdering: boolean;
  hideInternalProductDetails: boolean;
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
      className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-before-page print:px-10 print:py-12"
    >
      <div className="flex items-baseline justify-between mb-12 pb-6 border-b border-border print:mb-8 print:pb-4">
        <div>
          <div className="eyebrow">{projectName} · Category</div>
          <h2 className="font-display text-5xl mt-2 print:text-4xl">{category}</h2>
        </div>
        <div className="text-xs tracking-wide text-muted-foreground">
          {items.length} selection{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-14 print:space-y-10">
        {byRoom.map(({ room, list }) => (
          <div key={room!.id}>
            <div className="eyebrow mb-6 print:mb-4">{room!.name}</div>
            <div className="space-y-10 print:space-y-6">
              {list.map((it) => (
                <SpecCard
                  key={it.id}
                  item={it}
                  room={room!}
                  projectId={projectId}
                  canEditProducts={canEditProducts}
                  showLinks={showLinks}
                  showPricing={showPricing}
                  showOrdering={showOrdering}
                  hideInternalProductDetails={hideInternalProductDetails}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoomSpec({
  num,
  room,
  items,
  projectName,
  projectId,
  canEditProducts,
  showLinks,
  showPricing,
  showOrdering,
  hideInternalProductDetails,
}: {
  num: string;
  room: Room;
  items: MaterialItem[];
  projectName: string;
  projectId: string;
  canEditProducts: boolean;
  showLinks: boolean;
  showPricing: boolean;
  showOrdering: boolean;
  hideInternalProductDetails: boolean;
}) {
  const sections = sectionsForRoom(room.name);
  const grouped = useMemo(() => {
    const used = new Set<string>();
    const out = sections
      .map((sec) => {
        const list = items.filter((it) => it.category && sec.sources.includes(normalizeItemCategory(it.category) ?? it.category));
        list.forEach((it) => used.add(it.id));
        return { label: sec.label, list };
      })
      .filter((g) => g.list.length > 0);
    const leftover = items.filter((it) => !used.has(it.id));
    if (leftover.length > 0) out.push({ label: "Other", list: leftover });
    return out;
  }, [items, sections]);

  return (
    <section
      id={`room-${slug(room.name)}-${room.id.slice(0, 6)}`}
      className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-before-page print:px-10 print:py-12"
    >
      <div className="flex items-baseline justify-between mb-12 pb-6 border-b border-border print:mb-8 print:pb-4">
        <div>
          <div className="eyebrow">
            {num} · {projectName}
          </div>
          <h2 className="font-display text-5xl mt-2 print:text-4xl">{room.name}</h2>
        </div>
        <div className="text-xs tracking-wide text-muted-foreground">
          {items.length} selection{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-14 print:space-y-10">
        {grouped.map((g) => (
          <div key={g.label}>
            <div className="eyebrow mb-6 print:mb-4">{g.label}</div>
            <div className="space-y-10 print:space-y-6">
              {g.list.map((it) => (
                <SpecCard
                  key={it.id}
                  item={it}
                  room={room}
                  projectId={projectId}
                  canEditProducts={canEditProducts}
                  showLinks={showLinks}
                  showPricing={showPricing}
                  showOrdering={showOrdering}
                  hideInternalProductDetails={hideInternalProductDetails}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type ProductForm = Pick<
  Product,
  | "name"
  | "category"
  | "subcategory"
  | "vendor"
  | "product_url"
  | "image_url"
  | "finish"
  | "sku"
  | "dimensions"
  | "price"
  | "unit_cost"
  | "shipping"
  | "description"
>;

function SpecCard({
  item,
  room,
  projectId,
  canEditProducts,
  showLinks,
  showPricing,
  showOrdering,
  hideInternalProductDetails,
}: {
  item: MaterialItem;
  room: Room;
  projectId: string;
  canEditProducts: boolean;
  showLinks: boolean;
  showPricing: boolean;
  showOrdering: boolean;
  hideInternalProductDetails: boolean;
}) {
  const p = item.product;
  const displayName = clientProductName(item, room);
  const imageUrl = materialImageUrl(item);
  const [open, setOpen] = useState(false);
  return (
    <>
    <article
      className={`grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 pb-10 border-b border-border last:border-0 print:grid-cols-[170px_minmax(0,1fr)] print:gap-5 print:pb-6 print:break-inside-avoid ${
        canEditProducts && p ? "cursor-pointer transition-colors hover:bg-bone/30" : ""
      }`}
      onClick={() => {
        if (canEditProducts && p) setOpen(true);
      }}
    >
      <div className="aspect-square bg-bone overflow-hidden print:self-start print:max-w-[170px]">
        {imageUrl ? (
          <img
            src={normalizeSupabaseImageUrl(imageUrl)}
            alt={p?.name ?? displayName}
            className="w-full h-full object-contain p-4 print:p-2"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-muted-foreground font-display text-4xl">
            {displayName.charAt(0)}
          </div>
        )}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-4 mb-1 print:mb-0.5">
          <div className="eyebrow">{item.item_label}</div>
          {item.cad_label && (
            <span className="text-[10px] tracking-[0.18em] uppercase px-2 py-0.5 border border-border">
              {item.cad_label}
            </span>
          )}
        </div>
        <h3 className="font-display text-3xl leading-tight print:text-[28px]">{displayName}</h3>
        {!hideInternalProductDetails && actualProductName(item, room) && (
          <p className="text-sm text-muted-foreground mt-1 tracking-wide print:text-[12px]">
            {actualProductName(item, room)}
          </p>
        )}
        {p?.vendor && (
          <p className="text-sm text-muted-foreground mt-1 tracking-wide print:text-[12px]">{p.vendor}</p>
        )}

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm mt-6 print:mt-4 print:gap-x-6 print:gap-y-2 print:text-[12px]">
          <Detail label="Finish" value={p?.finish} />
          <Detail label="Color" value={item.color} />
          {showPricing && <Detail label="Client Price" value={priceLabel(p?.price)} />}
          {!hideInternalProductDetails && <Detail label="SKU" value={p?.sku} />}
          <Detail label="Dimensions" value={p?.dimensions} />
          <Detail label="CAD Label" value={item.cad_label} />
          <Detail label="Quantity" value={item.quantity != null ? String(item.quantity) : null} />
          {showOrdering && <Detail label="Ordered By" value={item.ordered_by} />}
          {showOrdering && <Detail label="Ordered" value={item.ordered ? "Yes" : "No"} />}
        </dl>

        {showLinks && p?.product_url && (
          <div className="mt-5 print:mt-3">
            <dt className="eyebrow mb-1">Product URL</dt>
            {externalHref(p.product_url) ? (
              <a
                href={externalHref(p.product_url) ?? undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="text-xs break-all underline inline-flex items-start gap-1 print:text-[10px] print:leading-tight"
              >
                {p.product_url} <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
              </a>
            ) : (
              <div className="text-xs break-all print:text-[10px] print:leading-tight">
                {p.product_url}
              </div>
            )}
          </div>
        )}

        {item.notes && (
          <div className="mt-5 print:mt-3">
            <dt className="eyebrow mb-1">Notes</dt>
            <p className="text-sm text-muted-foreground italic leading-relaxed print:text-[12px] print:leading-relaxed">
              {item.notes}
            </p>
          </div>
        )}
        {canEditProducts && p && (
          <p className="mt-5 text-[11px] tracking-[0.18em] uppercase text-muted-foreground print:hidden">
            Click to edit product info
          </p>
        )}
      </div>
    </article>
    {canEditProducts && p && (
      <SpecProductEditDialog
        open={open}
        onOpenChange={setOpen}
        item={item}
        product={p}
        projectId={projectId}
      />
    )}
    </>
  );
}

function SpecProductEditDialog({
  open,
  onOpenChange,
  item,
  product,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: MaterialItem;
  product: Product;
  projectId: string;
}) {
  const qc = useQueryClient();
  const [materialCategory, setMaterialCategory] = useState(normalizeItemCategory(item.category) || "Other");
  const [materialNotes, setMaterialNotes] = useState(item.notes ?? "");
  const [form, setForm] = useState<ProductForm>({
    name: product.name,
    category: product.category,
    subcategory: product.subcategory,
    vendor: product.vendor,
    product_url: product.product_url,
    image_url: item.image_url || product.image_url,
    finish: product.finish,
    sku: product.sku,
    dimensions: product.dimensions,
    price: product.price,
    unit_cost: product.unit_cost,
    shipping: product.shipping,
    description: product.description,
  });
  const [saving, setSaving] = useState(false);
  const productCategory = form.category as ProductCategory;

  const update = (patch: Partial<ProductForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Product name required");
    setSaving(true);
    try {
      await db.updateProduct(product.id, {
        ...form,
        name: form.name.trim(),
        vendor: clean(form.vendor),
        subcategory: clean(form.subcategory),
        product_url: clean(form.product_url),
        finish: clean(form.finish),
        sku: clean(form.sku),
        dimensions: clean(form.dimensions),
        price: normalizeMoneyInput(form.price),
        unit_cost: normalizeMoneyInput(form.unit_cost),
        shipping: normalizeMoneyInput(form.shipping),
        description: clean(form.description),
      });
      await db.updateMaterialItem(item.id, {
        category: materialCategory,
        image_url: clean(form.image_url),
        notes: clean(materialNotes),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["product", product.id] }),
        qc.invalidateQueries({ queryKey: ["catalog"] }),
        qc.invalidateQueries({ queryKey: ["materialItems", projectId] }),
        qc.invalidateQueries({ queryKey: ["procurement"] }),
      ]);
      toast.success("Product updated");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update product.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto print:hidden">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">Edit Product Info</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Product Name" value={form.name} onChange={(value) => update({ name: value })} />
          <Field label="Vendor" value={form.vendor ?? ""} onChange={(value) => update({ vendor: value })} />
          <div>
            <Label className="eyebrow">Category</Label>
            <Select
              value={materialCategory}
              onValueChange={(value) => {
                const nextProductCategory = toProductCategory(value);
                setMaterialCategory(value);
                update({
                  category: nextProductCategory,
                  subcategory: SUBCATEGORIES[nextProductCategory][0],
                });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_CATEGORIES.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="eyebrow">Subcategory</Label>
            <Select
              value={form.subcategory ?? SUBCATEGORIES[productCategory][0]}
              onValueChange={(value) => update({ subcategory: value })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBCATEGORIES[productCategory].map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field label="Client Price" value={form.price ?? ""} onChange={(value) => update({ price: value })} />
          <Field label="Unit Cost" value={form.unit_cost ?? ""} onChange={(value) => update({ unit_cost: value })} />
          <Field label="Shipping" value={form.shipping ?? ""} onChange={(value) => update({ shipping: value })} />
          <Field label="Dimensions" value={form.dimensions ?? ""} onChange={(value) => update({ dimensions: value })} />
          <Field label="Finish" value={form.finish ?? ""} onChange={(value) => update({ finish: value })} />
          <Field label="SKU" value={form.sku ?? ""} onChange={(value) => update({ sku: value })} />
          <Field label="Product URL" value={form.product_url ?? ""} onChange={(value) => update({ product_url: value })} className="md:col-span-2" />
          <Field label="Image URL" value={form.image_url ?? ""} onChange={(value) => update({ image_url: value })} className="md:col-span-2" />
          <LongField label="Spec Notes" value={materialNotes} onChange={setMaterialNotes} />
          <LongField label="Description" value={form.description ?? ""} onChange={(value) => update({ description: value })} />
        </div>
        <div className="flex justify-end pt-4">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 bg-ink text-primary-foreground text-sm disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Product"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function priceLabel(value: string | number | null | undefined) {
  const amount = moneyValue(value);
  return amount > 0 ? formatMoney(amount) : null;
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

function actualProductName(item: MaterialItem, room: Room) {
  const actualName = item.product?.name?.trim();
  if (!actualName) return null;
  const clientName = clientProductName(item, room).trim();
  return actualName.toLocaleLowerCase() === clientName.toLocaleLowerCase() ? null : actualName;
}

function Field({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div className={className}>
      <Label className="eyebrow">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function LongField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="md:col-span-2">
      <Label className="eyebrow">{label}</Label>
      <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function clean(value?: string | null) {
  return value?.trim() || null;
}
