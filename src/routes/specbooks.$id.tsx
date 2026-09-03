import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Printer, ExternalLink, ChevronDown, ChevronUp, Download } from "lucide-react";
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
import {
  canDownloadSpecBookPdf,
  canEditSpecBook,
  canUpdateSpecOrderingForRole,
  canViewProjectSurface,
  isStudioTeamRole,
  specBookVisibilityForRole,
} from "@/lib/permissions";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { materialImageUrl } from "@/lib/materialImages";
import { ProcurementCartBuilder } from "@/components/ProcurementCartBuilder";

export const Route = createFileRoute("/specbooks/$id")({
  head: () => ({ meta: [{ title: "Spec Book — MERAV Studio" }] }),
  component: SpecBookPage,
});

// Spec-book section ordering per room type. Each section maps to one or more
// material_items.category values. Items whose category doesn't match anything
// fall into a trailing "Other" group.
type Section = { label: string; sources: string[] };
type SpecJumpItem = { id: string; label: string };
type SpecLayout = "book" | "spreadsheet";
type SpecSpreadsheetRow = {
  id: string;
  productId: string;
  roomId: string;
  room: string;
  category: string;
  imageUrl: string;
  itemLabel: string;
  cadLabel: string;
  clientProductName: string;
  productName: string;
  vendor: string;
  finish: string;
  color: string;
  quantity: string;
  dimensions: string;
  sku: string;
  clientPrice: string;
  orderedBy: string;
  ordered: string;
  productUrl: string;
  notes: string;
  status: string;
};
type SpreadsheetColumnKey =
  | "image"
  | "room"
  | "category"
  | "item"
  | "cad"
  | "clientProductName"
  | "productName"
  | "vendor"
  | "finish"
  | "color"
  | "quantity"
  | "dimensions"
  | "sku"
  | "clientPrice"
  | "orderedBy"
  | "ordered"
  | "link"
  | "notes"
  | "status";

const SPREADSHEET_COLUMNS: Array<{ key: SpreadsheetColumnKey; label: string }> = [
  { key: "image", label: "Image" },
  { key: "room", label: "Room" },
  { key: "category", label: "Category" },
  { key: "item", label: "Item" },
  { key: "cad", label: "CAD" },
  { key: "clientProductName", label: "Client Product Name" },
  { key: "productName", label: "Product Name" },
  { key: "vendor", label: "Vendor" },
  { key: "finish", label: "Finish" },
  { key: "color", label: "Color" },
  { key: "quantity", label: "Qty" },
  { key: "dimensions", label: "Dimensions" },
  { key: "sku", label: "SKU" },
  { key: "clientPrice", label: "Client Price" },
  { key: "orderedBy", label: "Ordered By" },
  { key: "ordered", label: "Ordered" },
  { key: "link", label: "Link" },
  { key: "notes", label: "Notes" },
  { key: "status", label: "Status" },
];

function materialNeedsReselection(item: MaterialItem) {
  return item.room_product?.approval_status === "declined";
}

function NeedsReselectionBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-800 print:text-[8px]">
      <AlertTriangle className="h-3 w-3" />
      Needs re-selection
    </span>
  );
}

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

async function printSpecBook() {
  await waitForSpecImages();
  window.print();
}

async function waitForSpecImages() {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>("img[data-spec-image]"));
  const pending = images.filter((image) => !image.complete || image.naturalWidth === 0);
  if (pending.length === 0) return;

  await Promise.race([
    Promise.all(
      pending.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) {
              resolve();
              return;
            }
            const finish = () => resolve();
            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
          }),
      ),
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, 5000)),
  ]);
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
  const [layout, setLayout] = useState<SpecLayout>("book");
  const [view, setView] = useState<"room" | "category">("room");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [includeOverviewInPdf, setIncludeOverviewInPdf] = useState(true);
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

  const populatedRooms = rooms.filter((r) => (byRoom.get(r.id) ?? []).length > 0);
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room] as const)), [rooms]);
  const spreadsheetRows = useMemo(
    () => buildSpecSpreadsheetRows(items, populatedRooms, roomById),
    [items, populatedRooms, roomById],
  );
  const spreadsheetJumpItems = useMemo<SpecJumpItem[]>(() => {
    if (view === "room") {
      return populatedRooms.map((room) => ({
        id: spreadsheetGroupId("room", room.name, room.id),
        label: room.name,
      }));
    }
    const categories = Array.from(new Set(spreadsheetRows.map((row) => row.category || "Other")));
    return categories.map((category) => ({
      id: spreadsheetGroupId("category", category),
      label: category,
    }));
  }, [populatedRooms, spreadsheetRows, view]);
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
  const canEditProducts =
    !publicView &&
    canEditSpecBook(profile);
  const canEditOrdering =
    !publicView &&
    (canEditSpecBook(profile) || canUpdateSpecOrderingForRole(profile, project));
  const isSharedSpecView =
    (publicView || profile?.role === "Client" || profile?.role === "Contractor") && !canEditProducts;
  const visibility = publicView
    ? { showPricing: true, showLinks: true, showOrdering: true }
    : specBookVisibilityForRole(profile, project);
  const canDownloadPdf = publicView || canDownloadSpecBookPdf(profile, project);
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
        <div
          className={`print:hidden fixed bottom-6 right-6 z-40 hidden items-center gap-2 rounded-full border border-border bg-white/95 p-2 shadow-lg backdrop-blur md:flex ${
            layout === "book" ? "" : "md:hidden"
          }`}
        >
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
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="inline-flex border border-border text-xs tracking-[0.18em] uppercase">
              <button
                type="button"
                onClick={() => setLayout("book")}
                className={`px-4 py-2 ${layout === "book" ? "bg-ink text-primary-foreground" : "text-muted-foreground hover:text-ink"}`}
              >
                Book
              </button>
              <button
                type="button"
                onClick={() => setLayout("spreadsheet")}
                className={`px-4 py-2 border-l border-border ${layout === "spreadsheet" ? "bg-ink text-primary-foreground" : "text-muted-foreground hover:text-ink"}`}
              >
                Spreadsheet
              </button>
            </div>
            {layout === "book" && (
              <SpecJumpSelect
                items={jumpItems}
                value={jumpTarget}
                onJump={jumpToSection}
                className="w-[240px]"
              />
            )}
            {layout === "spreadsheet" && (
              <SpecJumpSelect
                items={spreadsheetJumpItems}
                value={jumpTarget}
                onJump={jumpToSection}
                className="w-[220px]"
              />
            )}
            {layout === "book" && (
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeOverviewInPdf}
                  onChange={(event) => setIncludeOverviewInPdf(event.target.checked)}
                  className="h-4 w-4 accent-ink"
                />
                Materials Overview in PDF
              </label>
            )}
            {(layout === "book" || layout === "spreadsheet") && (
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
            )}
            {!publicView && (
              <Link
                to="/projects/$id/presentation"
                params={{ id }}
                className="text-sm text-muted-foreground hover:text-ink underline-offset-4 hover:underline"
              >
                View Presentation
              </Link>
            )}
            {canDownloadPdf && (
              <button
                onClick={printSpecBook}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-primary-foreground text-sm"
              >
                <Printer className="w-4 h-4" /> Print / PDF
              </button>
            )}
          </div>
        </div>

        {!publicView && profile?.is_active && isStudioTeamRole(profile.role) && (
          <ProcurementCartBuilder project={project} rooms={rooms} items={items} />
        )}

        {layout === "spreadsheet" ? (
          <SpecSpreadsheetView
            projectId={id}
            projectName={project.name}
            clientName={project.client_name}
            today={today}
            specBookUrl={specBookUrl}
            qrCodeUrl={qrCodeUrl}
            rows={spreadsheetRows}
            groupBy={view}
            canEditProducts={canEditProducts}
            canEditOrdering={canEditOrdering}
            showPricing={visibility.showPricing}
            showLinks={visibility.showLinks}
            showOrdering={visibility.showOrdering}
            hideInternalProductDetails={isSharedSpecView}
          />
        ) : (
          <>
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
            <TocRow
              num="01"
              label="Materials Overview"
              href="#materials-overview"
              className={includeOverviewInPdf ? "" : "print:hidden"}
            />
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
          className={`border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-after-page ${
            includeOverviewInPdf ? "" : "print:hidden"
          }`}
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
                          {!isSharedSpecView && materialNeedsReselection(it) && (
                            <div className="mt-1">
                              <NeedsReselectionBadge />
                            </div>
                          )}
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
                canEditOrdering={canEditOrdering}
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
                    canEditOrdering={canEditOrdering}
                    showLinks={visibility.showLinks}
                    showPricing={visibility.showPricing}
                    showOrdering={visibility.showOrdering}
                    hideInternalProductDetails={isSharedSpecView}
                  />
                );
              });
            })()}
          </>
        )}
      </div>
  );
}

function SpecSpreadsheetView({
  projectId,
  projectName,
  clientName,
  today,
  specBookUrl,
  qrCodeUrl,
  rows,
  groupBy,
  canEditProducts,
  canEditOrdering,
  showPricing,
  showLinks,
  showOrdering,
  hideInternalProductDetails,
}: {
  projectId: string;
  projectName: string;
  clientName: string;
  today: string;
  specBookUrl: string;
  qrCodeUrl: string;
  rows: SpecSpreadsheetRow[];
  groupBy: "room" | "category";
  canEditProducts: boolean;
  canEditOrdering: boolean;
  showPricing: boolean;
  showLinks: boolean;
  showOrdering: boolean;
  hideInternalProductDetails: boolean;
}) {
  const qc = useQueryClient();
  const groups = useMemo(() => groupSpreadsheetRows(rows, groupBy), [groupBy, rows]);
  const availableColumns = useMemo(
    () =>
      SPREADSHEET_COLUMNS.filter((column) => {
        if (hideInternalProductDetails && (column.key === "productName" || column.key === "sku")) {
          return false;
        }
        if (hideInternalProductDetails && column.key === "status") return false;
        if (!showPricing && column.key === "clientPrice") return false;
        if (!showOrdering && (column.key === "orderedBy" || column.key === "ordered")) return false;
        if (!showLinks && column.key === "link") return false;
        return true;
      }),
    [hideInternalProductDetails, showLinks, showOrdering, showPricing],
  );
  const [hiddenColumns, setHiddenColumns] = useState<Set<SpreadsheetColumnKey>>(new Set());
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const visibleColumns = useMemo(
    () => availableColumns.filter((column) => !hiddenColumns.has(column.key)).map((column) => column.key),
    [availableColumns, hiddenColumns],
  );

  const refreshSpec = async (productId?: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["materialItems", projectId] }),
      qc.invalidateQueries({ queryKey: ["catalog"] }),
      qc.invalidateQueries({ queryKey: ["procurement"] }),
      productId ? qc.invalidateQueries({ queryKey: ["product", productId] }) : Promise.resolve(),
    ]);
  };

  const saveProductText = async (
    row: SpecSpreadsheetRow,
    key: "name" | "vendor" | "finish" | "dimensions" | "sku" | "product_url",
    value: string,
  ) => {
    const next = value.trim();
    if (key === "name" && !next) return toast.error("Product name required");
    await db.updateProduct(row.productId, { [key]: next || null });
    await refreshSpec(row.productId);
    toast.success("Spec updated");
  };

  const saveMaterialText = async (
    row: SpecSpreadsheetRow,
    key: "item_label" | "cad_label" | "client_product_name" | "color" | "notes" | "product_url",
    value: string,
  ) => {
    const next = value.trim();
    await db.updateMaterialItem(row.id, { [key]: next || null });
    if (key === "product_url") await db.updateProduct(row.productId, { product_url: next || null });
    await refreshSpec(row.productId);
    toast.success("Spec updated");
  };

  const saveCategory = async (row: SpecSpreadsheetRow, value: string) => {
    const next = value.trim();
    if (!next) return;
    const productCategory = toProductCategory(next);
    await Promise.all([
      db.updateMaterialItem(row.id, { category: next }),
      db.updateProduct(row.productId, {
        category: productCategory,
        subcategory: SUBCATEGORIES[productCategory][0],
      }),
    ]);
    await refreshSpec(row.productId);
    toast.success("Spec updated");
  };

  const saveQuantity = async (row: SpecSpreadsheetRow, value: string) => {
    const next = value.trim();
    const quantity = next === "" ? null : Number(next);
    if (quantity !== null && !Number.isFinite(quantity)) return toast.error("Enter a valid quantity");
    await db.updateMaterialItem(row.id, { quantity });
    await refreshSpec(row.productId);
    toast.success("Spec updated");
  };

  const savePrice = async (row: SpecSpreadsheetRow, value: string) => {
    await db.updateProduct(row.productId, { price: normalizeMoneyInput(value) });
    await refreshSpec(row.productId);
    toast.success("Spec updated");
  };

  const saveOrderedBy = async (row: SpecSpreadsheetRow, value: string) => {
    await db.updateMaterialItem(row.id, {
      ordered_by: value === "none" ? null : (value as MaterialItem["ordered_by"]),
    });
    await refreshSpec(row.productId);
    toast.success("Spec updated");
  };

  const saveOrdered = async (row: SpecSpreadsheetRow, value: boolean) => {
    await db.updateMaterialItem(row.id, { ordered: value });
    await refreshSpec(row.productId);
    toast.success("Spec updated");
  };

  const toggleColumn = (key: SpreadsheetColumnKey) => {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="border border-border bg-white p-8 print:border-0 print:p-0">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5 print:mb-3 print:pb-2">
        <div>
          <div className="eyebrow mb-2">MERAV Studio · Spreadsheet Spec Book</div>
          <h1 className="font-display text-4xl leading-tight print:text-2xl">{projectName}</h1>
          <p className="mt-1 text-sm text-muted-foreground print:text-[10px]">{clientName}</p>
        </div>
        <div className="flex items-end gap-4">
          <div className="hidden w-28 border border-border bg-bone/35 p-2 print:block">
            <img
              src={qrCodeUrl}
              alt="QR code linking to the online spec book"
              className="h-auto w-full"
              loading="eager"
            />
            <div className="mt-1 text-center text-[6px] uppercase tracking-[0.18em] text-muted-foreground">
              View Online
            </div>
          </div>
          <a
            href={specBookUrl}
            target="_blank"
            rel="noreferrer"
            className="print:hidden flex w-28 flex-col items-center border border-border bg-bone/35 p-2 hover:border-ink"
          >
            <img
              src={qrCodeUrl}
              alt="QR code linking to the online spec book"
              className="h-auto w-full"
              loading="eager"
            />
            <span className="mt-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              View Online
            </span>
          </a>
          <div className="text-right text-xs uppercase tracking-[0.18em] text-muted-foreground print:text-[9px]">
            {today}
          </div>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <details className="relative">
          <summary className="flex h-10 cursor-pointer list-none items-center border border-border bg-white px-3 text-xs uppercase tracking-[0.16em] text-muted-foreground hover:text-ink">
            Columns
          </summary>
          <div className="absolute left-0 z-30 mt-2 grid w-72 gap-2 border border-border bg-white p-3 shadow-lg sm:grid-cols-2">
            {availableColumns.map((column) => (
              <label key={column.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(column.key)}
                  onChange={() => toggleColumn(column.key)}
                  className="h-4 w-4 accent-ink"
                />
                {column.label}
              </label>
            ))}
            <button
              type="button"
              onClick={() => setHiddenColumns(new Set())}
              className="col-span-full mt-1 border border-border px-3 py-2 text-xs uppercase tracking-[0.14em] hover:border-ink"
            >
              Show All
            </button>
          </div>
        </details>
        <button
          type="button"
          disabled={isDownloadingExcel}
          onClick={async () => {
            setIsDownloadingExcel(true);
            try {
              await downloadSpecSpreadsheetWorkbook(
                projectName,
                groups,
                availableColumns.filter((column) => !hiddenColumns.has(column.key)),
              );
              toast.success("Excel spec book downloaded");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not create the Excel spec book");
            } finally {
              setIsDownloadingExcel(false);
            }
          }}
          className="inline-flex h-10 items-center gap-2 border border-border px-3 text-sm hover:border-ink"
        >
          <Download className="w-4 h-4" /> {isDownloadingExcel ? "Preparing Excel..." : "Download Excel"}
        </button>
        {canEditProducts && (
          <div className="text-xs text-muted-foreground">
            Click a cell to edit. Changes save back to the source spec/product.
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No products selected yet.</div>
      ) : (
        <div className="space-y-8 print:space-y-4">
          {groups.map((group) => (
            <section key={group.id} id={group.id} className="scroll-mt-24 break-inside-avoid">
              <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2 print:mb-1 print:pb-1">
                <h2 className="font-display text-2xl print:text-base">{group.label}</h2>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground print:text-[7px]">
                  {group.rows.length} item{group.rows.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="overflow-x-auto print:overflow-visible">
                <SpreadsheetTable
                  rows={group.rows}
                  columns={visibleColumns}
                  canEditProducts={canEditProducts}
                  canEditOrdering={canEditOrdering}
                  onSaveProductText={saveProductText}
                  onSaveMaterialText={saveMaterialText}
                  onSaveCategory={saveCategory}
                  onSaveQuantity={saveQuantity}
                  onSavePrice={savePrice}
                  onSaveOrderedBy={saveOrderedBy}
                  onSaveOrdered={saveOrdered}
                />
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function SpreadsheetTable({
  rows,
  columns,
  canEditProducts,
  canEditOrdering,
  onSaveProductText,
  onSaveMaterialText,
  onSaveCategory,
  onSaveQuantity,
  onSavePrice,
  onSaveOrderedBy,
  onSaveOrdered,
}: {
  rows: SpecSpreadsheetRow[];
  columns: SpreadsheetColumnKey[];
  canEditProducts: boolean;
  canEditOrdering: boolean;
  onSaveProductText: (
    row: SpecSpreadsheetRow,
    key: "name" | "vendor" | "finish" | "dimensions" | "sku" | "product_url",
    value: string,
  ) => Promise<void>;
  onSaveMaterialText: (
    row: SpecSpreadsheetRow,
    key: "item_label" | "cad_label" | "client_product_name" | "color" | "notes" | "product_url",
    value: string,
  ) => Promise<void>;
  onSaveCategory: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSaveQuantity: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSavePrice: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSaveOrderedBy: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSaveOrdered: (row: SpecSpreadsheetRow, value: boolean) => Promise<void>;
}) {
  return (
    <table className="w-full min-w-[1450px] border-collapse text-left text-xs print:min-w-0 print:text-[8px] print:leading-tight">
      <thead>
        <tr className="border-y border-border bg-bone/35">
          {columns.map((column) => (
            <SpreadsheetTh key={column}>
              {SPREADSHEET_COLUMNS.find((candidate) => candidate.key === column)?.label ?? column}
            </SpreadsheetTh>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="break-inside-avoid border-b border-border/70 align-top">
            {columns.map((column) => (
              <SpreadsheetTd key={column} className={column === "room" ? "font-display text-sm print:text-[9px]" : ""}>
                {spreadsheetCellForColumn({
                  column,
                  row,
                  canEditProducts,
                  canEditOrdering,
                  onSaveProductText,
                  onSaveMaterialText,
                  onSaveCategory,
                  onSaveQuantity,
                  onSavePrice,
                  onSaveOrderedBy,
                  onSaveOrdered,
                })}
              </SpreadsheetTd>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function spreadsheetCellForColumn({
  column,
  row,
  canEditProducts,
  canEditOrdering,
  onSaveProductText,
  onSaveMaterialText,
  onSaveCategory,
  onSaveQuantity,
  onSavePrice,
  onSaveOrderedBy,
  onSaveOrdered,
}: {
  column: SpreadsheetColumnKey;
  row: SpecSpreadsheetRow;
  canEditProducts: boolean;
  canEditOrdering: boolean;
  onSaveProductText: (
    row: SpecSpreadsheetRow,
    key: "name" | "vendor" | "finish" | "dimensions" | "sku" | "product_url",
    value: string,
  ) => Promise<void>;
  onSaveMaterialText: (
    row: SpecSpreadsheetRow,
    key: "item_label" | "cad_label" | "client_product_name" | "color" | "notes" | "product_url",
    value: string,
  ) => Promise<void>;
  onSaveCategory: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSaveQuantity: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSavePrice: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSaveOrderedBy: (row: SpecSpreadsheetRow, value: string) => Promise<void>;
  onSaveOrdered: (row: SpecSpreadsheetRow, value: boolean) => Promise<void>;
}) {
  switch (column) {
    case "image":
      return row.imageUrl ? (
        <div className="h-14 w-14 overflow-hidden border border-border bg-bone print:h-8 print:w-8">
          <img
            src={normalizeSupabaseImageUrl(row.imageUrl)}
            alt=""
            className="h-full w-full object-contain p-1"
            loading="eager"
            data-spec-image="true"
          />
        </div>
      ) : null;
    case "room":
      return row.room;
    case "category":
      return (
        <EditableSpecTextCell
          value={row.category}
          disabled={!canEditProducts}
          onSave={(value) => onSaveCategory(row, value)}
        />
      );
    case "item":
      return (
        <EditableSpecTextCell
          value={row.itemLabel}
          disabled={!canEditProducts}
          onSave={(value) => onSaveMaterialText(row, "item_label", value)}
        />
      );
    case "cad":
      return (
        <EditableSpecTextCell
          value={row.cadLabel}
          disabled={!canEditProducts}
          onSave={(value) => onSaveMaterialText(row, "cad_label", value)}
        />
      );
    case "clientProductName":
      return (
        <EditableSpecTextCell
          value={row.clientProductName}
          disabled={!canEditProducts}
          className="font-medium text-ink"
          onSave={(value) => onSaveMaterialText(row, "client_product_name", value)}
        />
      );
    case "productName":
      return (
        <EditableSpecTextCell
          value={row.productName}
          disabled={!canEditProducts}
          onSave={(value) => onSaveProductText(row, "name", value)}
        />
      );
    case "vendor":
      return (
        <EditableSpecTextCell
          value={row.vendor}
          disabled={!canEditProducts}
          onSave={(value) => onSaveProductText(row, "vendor", value)}
        />
      );
    case "finish":
      return (
        <EditableSpecTextCell
          value={row.finish}
          disabled={!canEditProducts}
          onSave={(value) => onSaveProductText(row, "finish", value)}
        />
      );
    case "color":
      return (
        <EditableSpecTextCell
          value={row.color}
          disabled={!canEditProducts}
          onSave={(value) => onSaveMaterialText(row, "color", value)}
        />
      );
    case "quantity":
      return (
        <EditableSpecTextCell
          value={row.quantity}
          disabled={!canEditProducts}
          inputMode="decimal"
          onSave={(value) => onSaveQuantity(row, value)}
        />
      );
    case "dimensions":
      return (
        <EditableSpecTextCell
          value={row.dimensions}
          disabled={!canEditProducts}
          onSave={(value) => onSaveProductText(row, "dimensions", value)}
        />
      );
    case "sku":
      return (
        <EditableSpecTextCell
          value={row.sku}
          disabled={!canEditProducts}
          onSave={(value) => onSaveProductText(row, "sku", value)}
        />
      );
    case "clientPrice":
      return (
        <EditableSpecTextCell
          value={row.clientPrice}
          disabled={!canEditProducts}
          inputMode="decimal"
          onSave={(value) => onSavePrice(row, value)}
        />
      );
    case "orderedBy":
      return canEditOrdering ? (
        <>
          <select
            value={row.orderedBy || "none"}
            onChange={(event) => onSaveOrderedBy(row, event.target.value)}
            className="h-8 w-28 border border-input bg-background px-2 text-xs print:hidden"
          >
            <option value="none">—</option>
            {SPEC_ORDERED_BY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <span className="hidden print:inline">{row.orderedBy}</span>
        </>
      ) : (
        row.orderedBy
      );
    case "ordered":
      return canEditOrdering ? (
        <>
          <label className="inline-flex items-center gap-2 print:hidden">
            <input
              type="checkbox"
              checked={row.ordered === "Yes"}
              onChange={(event) => onSaveOrdered(row, event.target.checked)}
              className="h-4 w-4 accent-ink"
            />
            {row.ordered}
          </label>
          <span className="hidden print:inline">{row.ordered}</span>
        </>
      ) : (
        row.ordered
      );
    case "link":
      return (
        <EditableSpecLinkCell
          value={row.productUrl}
          disabled={!canEditProducts}
          onSave={(value) => onSaveMaterialText(row, "product_url", value)}
        />
      );
    case "notes":
      return (
        <EditableSpecTextCell
          value={row.notes}
          disabled={!canEditProducts}
          onSave={(value) => onSaveMaterialText(row, "notes", value)}
        />
      );
    case "status":
      return row.status === "Needs re-selection" ? <NeedsReselectionBadge /> : row.status;
    default:
      return null;
  }
}

function EditableSpecTextCell({
  value,
  disabled,
  onSave,
  className = "",
  inputMode,
}: {
  value: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
  className?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === value.trim()) return;
    await onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        className={`max-w-[180px] truncate text-left underline-offset-4 print:max-w-none ${
          disabled ? "" : "hover:text-ink hover:underline"
        } ${className}`}
        title={disabled ? undefined : "Click to edit"}
      >
        {value || "—"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      inputMode={inputMode}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="h-8 w-40 border border-input bg-background px-2 text-xs"
    />
  );
}

function EditableSpecLinkCell({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const href = externalHref(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === value.trim()) return;
    await onSave(next);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-8 w-48 border border-input bg-background px-2 text-xs"
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="font-medium text-ink underline">
          LINK
        </a>
      ) : (
        <span>—</span>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline-offset-4 hover:text-ink hover:underline print:hidden"
        >
          Edit
        </button>
      )}
    </div>
  );
}

function SpreadsheetTh({ children }: { children: ReactNode }) {
  return (
    <th className="px-2 py-2 align-bottom text-[10px] font-normal uppercase tracking-[0.14em] text-muted-foreground print:px-1 print:py-1 print:text-[6px]">
      {children}
    </th>
  );
}

function SpreadsheetTd({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`max-w-[180px] px-2 py-2 text-muted-foreground print:max-w-none print:px-1 print:py-1 ${className}`}>
      {children || "—"}
    </td>
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

function TocRow({
  num,
  label,
  href,
  className = "",
}: {
  num: string;
  label: string;
  href: string;
  className?: string;
}) {
  return (
    <li className={className}>
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
  canEditOrdering,
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
  canEditOrdering: boolean;
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
      className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-before-page print:px-8 print:py-8"
    >
      <div className="flex items-baseline justify-between mb-12 pb-6 border-b border-border print:mb-5 print:pb-3">
        <div>
          <div className="eyebrow">{projectName} · Category</div>
          <h2 className="font-display text-5xl mt-2 print:text-3xl">{category}</h2>
        </div>
        <div className="text-xs tracking-wide text-muted-foreground">
          {items.length} selection{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-14 print:space-y-5">
        {byRoom.map(({ room, list }) => (
          <div key={room!.id}>
            <div className="eyebrow mb-6 print:mb-2">{room!.name}</div>
            <div className="space-y-10 print:space-y-3">
              {list.map((it) => (
                <SpecCard
                  key={it.id}
                  item={it}
                  room={room!}
                  projectId={projectId}
                  canEditProducts={canEditProducts}
                  canEditOrdering={canEditOrdering}
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
  canEditOrdering,
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
  canEditOrdering: boolean;
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
      className="border border-border bg-white p-12 lg:p-16 mb-10 print:border-0 print:break-before-page print:px-8 print:py-8"
    >
      <div className="flex items-baseline justify-between mb-12 pb-6 border-b border-border print:mb-5 print:pb-3">
        <div>
          <div className="eyebrow">
            {num} · {projectName}
          </div>
          <h2 className="font-display text-5xl mt-2 print:text-3xl">{room.name}</h2>
        </div>
        <div className="text-xs tracking-wide text-muted-foreground">
          {items.length} selection{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-14 print:space-y-5">
        {grouped.map((g) => (
          <div key={g.label}>
            <div className="eyebrow mb-6 print:mb-2">{g.label}</div>
            <div className="space-y-10 print:space-y-3">
              {g.list.map((it) => (
                <SpecCard
                  key={it.id}
                  item={it}
                  room={room}
                  projectId={projectId}
                  canEditProducts={canEditProducts}
                  canEditOrdering={canEditOrdering}
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
  canEditOrdering,
  showLinks,
  showPricing,
  showOrdering,
  hideInternalProductDetails,
}: {
  item: MaterialItem;
  room: Room;
  projectId: string;
  canEditProducts: boolean;
  canEditOrdering: boolean;
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
      className={`grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 pb-10 border-b border-border last:border-0 print:grid-cols-[120px_minmax(0,1fr)] print:gap-4 print:pb-3 print:break-inside-avoid ${
        canEditProducts && p ? "cursor-pointer transition-colors hover:bg-bone/30" : ""
      }`}
      onClick={() => {
        if (canEditProducts && p) setOpen(true);
      }}
    >
      <div className="aspect-square bg-bone overflow-hidden print:self-start print:max-w-[120px]">
        {imageUrl ? (
          <img
            src={normalizeSupabaseImageUrl(imageUrl)}
            alt={p?.name ?? displayName}
            className="w-full h-full object-contain p-4 print:p-1.5"
            loading="eager"
            data-spec-image="true"
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
        <h3 className="font-display text-3xl leading-tight print:text-[22px]">{displayName}</h3>
        {!hideInternalProductDetails && materialNeedsReselection(item) && (
          <div className="mt-2">
            <NeedsReselectionBadge />
          </div>
        )}
        {!hideInternalProductDetails && actualProductName(item, room) && (
          <p className="text-sm text-muted-foreground mt-1 tracking-wide print:text-[10px] print:leading-snug">
            {actualProductName(item, room)}
          </p>
        )}
        {p?.vendor && (
          <p className="text-sm text-muted-foreground mt-1 tracking-wide print:text-[10px] print:leading-snug">{p.vendor}</p>
        )}

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm mt-6 print:mt-2 print:gap-x-4 print:gap-y-1 print:text-[10px] print:leading-snug">
          <Detail label="Finish" value={p?.finish} />
          <Detail label="Color" value={item.color} />
          {showPricing && <Detail label="Client Price" value={priceLabel(p?.price)} />}
          {!hideInternalProductDetails && <Detail label="SKU" value={p?.sku} />}
          <Detail label="Dimensions" value={p?.dimensions} />
          <Detail label="CAD Label" value={item.cad_label} />
          <Detail label="Quantity" value={item.quantity != null ? String(item.quantity) : null} />
          {showOrdering && <Detail label="Who Is Ordering" value={item.ordered_by} />}
          {showOrdering && <Detail label="Ordered" value={item.ordered ? "Yes" : "No"} />}
        </dl>

        {showOrdering && canEditOrdering && (
          <SpecOrderingControls item={item} projectId={projectId} />
        )}

        {showLinks && p?.product_url && (
          <div className="mt-5 print:mt-2">
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
          <div className="mt-5 print:mt-2">
            <dt className="eyebrow mb-1">Notes</dt>
            <p className="text-sm text-muted-foreground italic leading-relaxed print:text-[10px] print:leading-snug">
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

const SPEC_ORDERED_BY_OPTIONS = ["Contractor", "Merav", "Client"] as const;

function SpecOrderingControls({ item, projectId }: { item: MaterialItem; projectId: string }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<MaterialItem>) => {
    setSaving(true);
    try {
      await db.updateMaterialItem(item.id, patch);
      await qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
      toast.success("Ordering updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update ordering.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-5 grid gap-3 border border-border bg-bone/25 p-4 print:hidden sm:grid-cols-[minmax(0,220px)_auto]"
      onClick={(event) => event.stopPropagation()}
    >
      <div>
        <Label className="eyebrow">Who Is Ordering</Label>
        <Select
          value={item.ordered_by ?? "none"}
          disabled={saving}
          onValueChange={(value) =>
            save({ ordered_by: value === "none" ? null : (value as MaterialItem["ordered_by"]) })
          }
        >
          <SelectTrigger className="mt-1 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not set</SelectItem>
            {SPEC_ORDERED_BY_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-end gap-3 pb-3 text-sm">
        <input
          type="checkbox"
          checked={item.ordered === true}
          disabled={saving}
          onChange={(event) => save({ ordered: event.target.checked })}
          className="h-4 w-4 accent-ink"
        />
        Ordered
      </label>
    </div>
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
      <dt className="eyebrow mb-1 print:mb-0">{label}</dt>
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

function buildSpecSpreadsheetRows(
  items: MaterialItem[],
  rooms: Room[],
  roomById: Map<string, Room>,
): SpecSpreadsheetRow[] {
  const roomOrder = new Map(rooms.map((room, index) => [room.id, index]));
  return items
    .filter((item) => !item.not_needed && item.product_id && item.product)
    .slice()
    .sort((a, b) => {
      const roomDelta = (roomOrder.get(a.room_id) ?? 9999) - (roomOrder.get(b.room_id) ?? 9999);
      if (roomDelta !== 0) return roomDelta;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .map((item) => {
      const room = roomById.get(item.room_id);
      const product = item.product;
      return {
        id: item.id,
        productId: item.product_id ?? "",
        roomId: item.room_id,
        room: room?.name ?? "Unassigned",
        category: normalizeItemCategory(item.category) ?? item.category ?? "",
        imageUrl: materialImageUrl(item) ?? "",
        itemLabel: item.item_label ?? "",
        cadLabel: item.cad_label ?? "",
        clientProductName: room ? clientProductName(item, room) : item.client_product_name || product?.name || "",
        productName: product?.name ?? "",
        vendor: product?.vendor ?? "",
        finish: product?.finish ?? "",
        color: item.color ?? "",
        quantity: item.quantity != null ? String(item.quantity) : "",
        dimensions: product?.dimensions ?? "",
        sku: product?.sku ?? "",
        clientPrice: priceLabel(product?.price) ?? "",
        orderedBy: item.ordered_by ?? "",
        ordered: item.ordered ? "Yes" : "No",
        productUrl: item.product_url || product?.product_url || "",
        notes: item.notes ?? "",
        status: materialNeedsReselection(item) ? "Needs re-selection" : "",
      };
    });
}

function groupSpreadsheetRows(rows: SpecSpreadsheetRow[], groupBy: "room" | "category") {
  const groups = new Map<string, { id: string; label: string; rows: SpecSpreadsheetRow[] }>();
  rows.forEach((row) => {
    const label = groupBy === "room" ? row.room : row.category || "Other";
    const id =
      groupBy === "room"
        ? spreadsheetGroupId(groupBy, label, row.roomId)
        : spreadsheetGroupId(groupBy, label);
    const group = groups.get(id) ?? { id, label, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  });
  const out = Array.from(groups.values());
  if (groupBy === "category") {
    out.sort((a, b) => {
      const ai = ALL_CATEGORIES.indexOf(a.label);
      const bi = ALL_CATEGORIES.indexOf(b.label);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.label.localeCompare(b.label);
    });
  }
  return out;
}

function spreadsheetGroupId(groupBy: "room" | "category", label: string, id?: string) {
  return `sheet-${groupBy}-${slug(label || "other")}${id ? `-${id.slice(0, 6)}` : ""}`;
}

async function downloadSpecSpreadsheetWorkbook(
  projectName: string,
  groups: Array<{ id: string; label: string; rows: SpecSpreadsheetRow[] }>,
  columns: Array<{ key: SpreadsheetColumnKey; label: string }>,
) {
  const { strToU8, zipSync } = await import("fflate");
  const imageColumnIndex = columns.findIndex((column) => column.key === "image");
  const createdAt = new Date().toISOString();
  const lastColumn = excelColumnName(Math.max(columns.length - 1, 0));
  const worksheetRows: string[] = [];
  const groupHeaderRows: number[] = [];
  const imageRows: Array<{ row: SpecSpreadsheetRow; sheetRowIndex: number }> = [];
  let excelRow = 1;

  groups.forEach((group, groupIndex) => {
    groupHeaderRows.push(excelRow);
    worksheetRows.push(
      `<row r="${excelRow}" ht="28" customHeight="1"><c r="A${excelRow}" t="inlineStr" s="3"><is><t>${xmlEscape(group.label)}</t></is></c></row>`,
    );
    excelRow += 1;

    const headerCells = columns
      .map(
        (column, index) =>
          `<c r="${excelColumnName(index)}${excelRow}" t="inlineStr" s="1"><is><t>${xmlEscape(column.label)}</t></is></c>`,
      )
      .join("");
    worksheetRows.push(`<row r="${excelRow}" ht="24" customHeight="1">${headerCells}</row>`);
    excelRow += 1;

    group.rows.forEach((row) => {
      const cells = columns
        .map((column, columnIndex) => spreadsheetCellXml(row, column.key, columnIndex, excelRow))
        .join("");
      worksheetRows.push(`<row r="${excelRow}" ht="78" customHeight="1">${cells}</row>`);
      imageRows.push({ row, sheetRowIndex: excelRow - 1 });
      excelRow += 1;
    });

    if (groupIndex < groups.length - 1) {
      worksheetRows.push(`<row r="${excelRow}" ht="10" customHeight="1"/>`);
      excelRow += 1;
    }
  });

  if (groups.length === 0) {
    worksheetRows.push(
      '<row r="1" ht="24" customHeight="1"><c r="A1" t="inlineStr" s="3"><is><t>No products selected</t></is></c></row>',
    );
    groupHeaderRows.push(1);
    excelRow = 2;
  }

  const thumbnails = imageColumnIndex === -1 ? [] : await loadSpreadsheetThumbnails(imageRows);
  const columnWidths = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${spreadsheetColumnWidth(column.key)}" customWidth="1"/>`)
    .join("");
  const lastCell = `${lastColumn}${Math.max(excelRow - 1, 1)}`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypesXml(thumbnails.length > 0)),
    "_rels/.rels": strToU8(rootRelationshipsXml()),
    "docProps/app.xml": strToU8(appPropertiesXml()),
    "docProps/core.xml": strToU8(corePropertiesXml(createdAt)),
    "xl/workbook.xml": strToU8(workbookXml()),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationshipsXml()),
    "xl/styles.xml": strToU8(workbookStylesXml()),
    "xl/worksheets/sheet1.xml": strToU8(
      worksheetXml(columnWidths, worksheetRows.join(""), lastCell, groupHeaderRows, lastColumn, thumbnails.length > 0),
    ),
  };

  if (thumbnails.length > 0) {
    files["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(worksheetRelationshipsXml());
    files["xl/drawings/drawing1.xml"] = strToU8(drawingXml(thumbnails, imageColumnIndex));
    files["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(drawingRelationshipsXml(thumbnails));
    thumbnails.forEach((thumbnail, index) => {
      files[`xl/media/image${index + 1}.png`] = thumbnail.bytes;
    });
  }

  const archive = zipSync(files, { level: 6 });
  const blob = new Blob([new Uint8Array(archive)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeSpecFileName(projectName)}-spec-book.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function spreadsheetCellXml(
  row: SpecSpreadsheetRow,
  key: SpreadsheetColumnKey,
  columnIndex: number,
  excelRow: number,
) {
  const reference = `${excelColumnName(columnIndex)}${excelRow}`;
  const value = key === "image" ? "" : spreadsheetCellValue(row, key);

  if (key === "quantity" && value.trim() !== "") {
    const quantity = Number(value);
    if (Number.isFinite(quantity)) {
      return `<c r="${reference}" s="2"><v>${quantity}</v></c>`;
    }
  }

  return `<c r="${reference}" t="inlineStr" s="2"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function spreadsheetCellValue(row: SpecSpreadsheetRow, key: SpreadsheetColumnKey) {
  switch (key) {
    case "image":
      return "";
    case "room":
      return row.room;
    case "category":
      return row.category;
    case "item":
      return row.itemLabel;
    case "cad":
      return row.cadLabel;
    case "clientProductName":
      return row.clientProductName;
    case "productName":
      return row.productName;
    case "vendor":
      return row.vendor;
    case "finish":
      return row.finish;
    case "color":
      return row.color;
    case "quantity":
      return row.quantity;
    case "dimensions":
      return row.dimensions;
    case "sku":
      return row.sku;
    case "clientPrice":
      return row.clientPrice;
    case "orderedBy":
      return row.orderedBy;
    case "ordered":
      return row.ordered;
    case "link":
      return row.productUrl;
    case "notes":
      return row.notes;
    case "status":
      return row.status;
    default:
      return "";
  }
}

type SpreadsheetThumbnail = {
  bytes: Uint8Array;
  rowIndex: number;
};

async function loadSpreadsheetThumbnails(rows: Array<{ row: SpecSpreadsheetRow; sheetRowIndex: number }>) {
  const thumbnails: SpreadsheetThumbnail[] = [];
  const batchSize = 6;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const results = await Promise.all(
      batch.map(async ({ row, sheetRowIndex }) => {
        const imageUrl = normalizeSupabaseImageUrl(row.imageUrl).trim();
        if (!imageUrl) return null;
        try {
          return {
            bytes: await imageUrlToThumbnailPng(imageUrl),
            rowIndex: sheetRowIndex,
          };
        } catch {
          return null;
        }
      }),
    );
    results.forEach((result) => {
      if (result) thumbnails.push(result);
    });
  }
  return thumbnails;
}

async function imageUrlToThumbnailPng(imageUrl: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) throw new Error("Image download failed");
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion failed");
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
    bitmap.close();
    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Image conversion failed"))), "image/png");
    });
    return new Uint8Array(await thumbnail.arrayBuffer());
  } finally {
    window.clearTimeout(timeout);
  }
}

function excelColumnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function spreadsheetColumnWidth(key: SpreadsheetColumnKey) {
  const widths: Partial<Record<SpreadsheetColumnKey, number>> = {
    image: 16,
    room: 20,
    category: 18,
    item: 22,
    cad: 12,
    clientProductName: 28,
    productName: 30,
    vendor: 22,
    finish: 18,
    color: 18,
    quantity: 9,
    dimensions: 24,
    sku: 16,
    clientPrice: 14,
    orderedBy: 15,
    ordered: 11,
    link: 38,
    notes: 36,
    status: 15,
  };
  return widths[key] ?? 18;
}

function xmlEscape(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function contentTypesXml(hasImages: boolean) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${hasImages ? '<Default Extension="png" ContentType="image/png"/>' : ""}
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${hasImages ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}
</Types>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function appPropertiesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>MERAV Studio</Application>
</Properties>`;
}

function corePropertiesXml(createdAt: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>MERAV Studio</dc:creator>
  <cp:lastModifiedBy>MERAV Studio</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`;
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Spec Book" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function workbookRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function workbookStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="10"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><color rgb="FF211E1A"/><sz val="14"/><name val="Aptos Display"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF211E1A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2EFE9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD8D3CB"/></left><right style="thin"><color rgb="FFD8D3CB"/></right><top style="thin"><color rgb="FFD8D3CB"/></top><bottom style="thin"><color rgb="FFD8D3CB"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function worksheetXml(
  columns: string,
  rows: string,
  lastCell: string,
  groupHeaderRows: number[],
  lastColumn: string,
  hasImages: boolean,
) {
  const mergedGroups = groupHeaderRows
    .map((row) => `<mergeCell ref="A${row}:${lastColumn}${row}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${rows}</sheetData>
  <mergeCells count="${groupHeaderRows.length}">${mergedGroups}</mergeCells>
  ${hasImages ? '<drawing r:id="rId1"/>' : ""}
</worksheet>`;
}

function worksheetRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
}

function drawingXml(thumbnails: SpreadsheetThumbnail[], imageColumnIndex: number) {
  const anchors = thumbnails
    .map((thumbnail, index) => {
      const rowIndex = thumbnail.rowIndex;
      return `<xdr:oneCellAnchor>
  <xdr:from><xdr:col>${imageColumnIndex}</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>${rowIndex}</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from>
  <xdr:ext cx="914400" cy="914400"/>
  <xdr:pic>
    <xdr:nvPicPr><xdr:cNvPr id="${index + 1}" name="Product image ${index + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
    <xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
    <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:oneCellAnchor>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

function drawingRelationshipsXml(thumbnails: SpreadsheetThumbnail[]) {
  const relationships = thumbnails
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}.png"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;
}

function sanitizeSpecFileName(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "spec-book";
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
