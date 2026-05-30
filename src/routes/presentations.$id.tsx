import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { ArrowLeft, Printer, Maximize2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { useEffect, useState, useCallback, useMemo } from "react";

export const Route = createFileRoute("/presentations/$id")({
  head: () => ({ meta: [{ title: "Presentation — MERAV Studio" }] }),
  component: PresentationPage,
});

type RoomData = {
  views: { hero?: any; sketch?: any; label?: string }[];
  materials: any[];
  cabinetProduct: any;
  cabinetMaterial: any;
  counter: any;
  faucet: any;
};

function buildRoomData(images: any[], selections: any[], materials: any[]): RoomData {
  const approvedRenders = images.filter(i => i.kind === "rendering" && i.status === "complete" && i.is_approved !== false);
  approvedRenders.sort((a, b) => {
    // Heroes first, then favorites, then sort_order
    const score = (x: any) => (x.role === "hero" ? 0 : 1) + (x.is_favorite ? 0 : 0.1);
    return score(a) - score(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const sketchups = images.filter(i => i.kind === "sketchup");
  const linkedSketchIds = new Set(approvedRenders.map(r => r.linked_sketchup_id).filter(Boolean));
  const fallbackSketch = sketchups[0];

  const views: RoomData["views"] = [];
  for (const r of approvedRenders) {
    const sketch = sketchups.find(s => s.id === r.linked_sketchup_id) || fallbackSketch;
    views.push({ hero: r, sketch, label: r.caption });
  }
  // Sketchups not linked to any rendering — show on their own page
  for (const s of sketchups) {
    if (!linkedSketchIds.has(s.id) && !views.some(v => v.sketch?.id === s.id && !v.hero)) {
      // only add as standalone if there are no renderings (so we don't duplicate the fallback)
      if (approvedRenders.length === 0) views.push({ sketch: s });
    }
  }
  if (views.length === 0) views.push({ sketch: fallbackSketch });

  const key = selections.filter(s => s.is_key_selection);
  const pickProduct = (cat: string) =>
    key.find(s => s.product?.category === cat) || selections.find(s => s.product?.category === cat);

  return {
    views,
    materials,
    cabinetProduct: pickProduct("Hardware"),
    cabinetMaterial: materials.find(m => m.category === "Cabinet Finish"),
    counter: materials.find(m => m.category === "Countertop"),
    faucet: pickProduct("Plumbing"),
  };
}

function PresentationPage() {
  const { id: projectId } = Route.useParams();
  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => db.getProject(projectId) });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", projectId], queryFn: async () => (await db.listRooms(projectId)) ?? [] });

  // Fetch data for all rooms in parallel
  const roomQueries = useQueries({
    queries: rooms.flatMap(r => [
      { queryKey: ["roomImages", r.id], queryFn: async () => (await db.listRoomImages(r.id)) ?? [] },
      { queryKey: ["roomProducts", r.id], queryFn: async () => (await db.listRoomProducts(r.id)) ?? [] },
      { queryKey: ["materials", r.id], queryFn: async () => (await db.listMaterials(r.id)) ?? [] },
    ]),
  });

  const roomData = useMemo(() => {
    return rooms.map((r, idx) => {
      const images = (roomQueries[idx * 3]?.data as any[]) || [];
      const selections = (roomQueries[idx * 3 + 1]?.data as any[]) || [];
      const materials = (roomQueries[idx * 3 + 2]?.data as any[]) || [];
      return { room: r, data: buildRoomData(images, selections, materials) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, roomQueries.map(q => q.dataUpdatedAt).join(",")]);

  // Flat list of slides: cover + every view in every room
  const slides = useMemo(() => {
    const list: { kind: "cover" } | any = [{ kind: "cover" }];
    roomData.forEach(({ room, data }) => {
      data.views.forEach((view, vi) => {
        list.push({ kind: "view", room, data, view, viewIndex: vi, viewCount: data.views.length });
      });
    });
    return list as ({ kind: "cover" } | { kind: "view"; room: any; data: RoomData; view: RoomData["views"][number]; viewIndex: number; viewCount: number })[];
  }, [roomData]);

  const [presenting, setPresenting] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || presenting) return;
    const h = window.location.hash;
    if (h && rooms.length) {
      const el = document.querySelector(h);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [rooms.length, presenting]);

  const enterPresent = useCallback(async () => {
    setSlide(0);
    setPresenting(true);
    try { await document.documentElement.requestFullscreen?.(); } catch {}
  }, []);

  const exitPresent = useCallback(async () => {
    setPresenting(false);
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  }, []);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setSlide(s => Math.min(s + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setSlide(s => Math.max(s - 1, 0));
      } else if (e.key === "Escape") {
        exitPresent();
      }
    };
    const onFs = () => { if (!document.fullscreenElement) setPresenting(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFs); };
  }, [presenting, slides.length, exitPresent]);

  if (!project) return <AppShell><div className="p-16">Loading…</div></AppShell>;

  if (presenting) {
    const total = slides.length;
    const current = slides[Math.min(slide, total - 1)];
    return (
      <div className="present-mode flex flex-col">
        <div className="flex-1 overflow-hidden flex items-center justify-center">
          {current.kind === "cover" ? (
            <CoverSlide project={project} roomCount={rooms.length} />
          ) : (
            <RoomSlide project={project} room={current.room} data={current.data} view={current.view} viewIndex={current.viewIndex} viewCount={current.viewCount} />
          )}
        </div>
        <div className="absolute top-4 right-4 flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity">
          <span className="text-xs text-muted-foreground">{slide + 1} / {total}</span>
          <button onClick={exitPresent} className="p-2 hover:bg-muted rounded" aria-label="Exit">
            <X className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => setSlide(s => Math.max(s - 1, 0))}
          disabled={slide === 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-background/60 backdrop-blur border border-border hover:bg-background disabled:opacity-20"
          aria-label="Previous"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => setSlide(s => Math.min(s + 1, total - 1))}
          disabled={slide >= total - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-background/60 backdrop-blur border border-border hover:bg-background disabled:opacity-20"
          aria-label="Next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="px-8 lg:px-14 py-8 print:p-0">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <Link to="/projects/$id" params={{ id: project.id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to project
          </Link>
          <div className="flex items-center gap-2">
            <button onClick={enterPresent} className="inline-flex items-center gap-2 px-5 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors">
              <Maximize2 className="w-4 h-4" /> Present
            </button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-primary-foreground text-sm">
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
          </div>
        </div>

        <div className="hidden print:flex print-page min-h-[9.5in] flex-col justify-between p-12">
          <div className="eyebrow">MERAV Studio · Presentation</div>
          <div>
            <div className="eyebrow text-xs">{project.client_name}</div>
            <h1 className="editorial-hero text-7xl mt-4">{project.name}</h1>
          </div>
          <div className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
            {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </div>
        </div>

        <div className="mb-10 print:hidden">
          <div className="eyebrow text-[11px]">{project.client_name}</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl mt-2">{project.name}</h1>
          {rooms.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {rooms.map(r => (
                <a key={r.id} href={`#room-${r.id}`} className="hover:text-ink underline-offset-4 hover:underline">{r.name}</a>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-12 print:space-y-0">
          {rooms.length === 0 && <div className="text-sm text-muted-foreground">No rooms yet.</div>}
          {roomData.map(({ room, data }) =>
            data.views.map((view, vi) => (
              <RoomSpread
                key={`${room.id}-${vi}`}
                project={project}
                room={room}
                data={data}
                view={view}
                viewIndex={vi}
                viewCount={data.views.length}
                anchor={vi === 0 ? `room-${room.id}` : undefined}
              />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

function CoverSlide({ project, roomCount }: { project: any; roomCount: number }) {
  return (
    <div className="w-full h-full flex flex-col justify-between p-16 lg:p-24">
      <div className="eyebrow">MERAV Studio · Presentation</div>
      <div>
        <div className="eyebrow text-xs mb-4">{project.client_name}</div>
        <h1 className="editorial-hero text-6xl lg:text-9xl">{project.name}</h1>
        <p className="mt-8 text-muted-foreground">{roomCount} {roomCount === 1 ? "room" : "rooms"}</p>
      </div>
      <div className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
        {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

function RoomSlide({ project, room, data, view, viewIndex, viewCount }: { project: any; room: any; data: RoomData; view: RoomData["views"][number]; viewIndex: number; viewCount: number }) {
  return (
    <div className="w-full h-full grid lg:grid-cols-[1.6fr_1fr] gap-6 p-8 lg:p-12">
      <div className="flex flex-col min-h-0">
        <div className="mb-4">
          <div className="eyebrow text-[11px]">
            {project.name} · {project.client_name}
            {viewCount > 1 && <span className="ml-2 opacity-60">· View {viewIndex + 1} of {viewCount}</span>}
          </div>
          <h2 className="font-display text-4xl lg:text-6xl text-ink mt-2 leading-tight">{room.name}</h2>
          {view.label && <div className="text-sm text-muted-foreground mt-1">{view.label}</div>}
        </div>
        <div className="relative bg-bone overflow-hidden flex-1 min-h-0">
          {view.hero ? (
            <img src={view.hero.url} alt={room.name} className="w-full h-full object-contain" />
          ) : view.sketch ? (
            <img src={view.sketch.url} alt={room.name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image yet</div>
          )}
        </div>
      </div>
      <SpreadSidebar data={data} view={view} />
    </div>
  );
}

function RoomSpread({ project, room, data, view, viewIndex, viewCount, anchor }: { project: any; room: any; data: RoomData; view: RoomData["views"][number]; viewIndex: number; viewCount: number; anchor?: string }) {
  const showSketchInCard = view.hero && view.sketch; // only when hero exists; otherwise sketch is the hero
  return (
    <section id={anchor} className="bg-background border border-border print:border-0 print-page scroll-mt-24">
      <div className="px-10 lg:px-14 pt-10 pb-6 print:pt-6">
        <div className="eyebrow text-[11px]">
          {project.name} · {project.client_name}
          {viewCount > 1 && <span className="ml-2 opacity-60">· View {viewIndex + 1} of {viewCount}</span>}
        </div>
        <h2 className="font-display text-4xl lg:text-5xl text-ink mt-2 leading-tight">{room.name}</h2>
        {view.label && <div className="text-sm text-muted-foreground mt-1">{view.label}</div>}
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 px-10 lg:px-14 pb-12 print:pb-6">
        <div className="relative bg-bone overflow-hidden aspect-[4/3] lg:aspect-auto lg:min-h-[640px] print:min-h-0 print:aspect-[4/3]">
          {view.hero ? (
            <img src={view.hero.url} alt={room.name} className="w-full h-full object-contain" />
          ) : view.sketch ? (
            <img src={view.sketch.url} alt={room.name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image yet</div>
          )}
          {view.hero && (
            <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8 bg-gradient-to-t from-black/60 to-transparent text-primary-foreground pointer-events-none">
              <div className="eyebrow text-[10px] text-primary-foreground/80">Photoreal Visualization</div>
              <p className="font-display text-sm lg:text-base mt-1 max-w-md leading-snug">
                A true-to-life preview of your space, designed to give you confidence in every material, finish, and detail.
              </p>
            </div>
          )}
        </div>
        <SpreadSidebar data={data} view={view} showSketch={showSketchInCard} />
      </div>
    </section>
  );
}

function SpreadSidebar({ data, view, showSketch = true }: { data: RoomData; view: RoomData["views"][number]; showSketch?: boolean }) {
  return (
    <div className="flex flex-col gap-6 print:gap-3">
      {showSketch && (
        <Card label="Design Model">
          <div className="aspect-[4/3] bg-bone overflow-hidden">
            {view.sketch ? (
              <img src={view.sketch.url} alt="" className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-muted-foreground">No SketchUp yet</div>
            )}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-6 print:gap-3">
        <Card label="Material Palette">
          <div className="grid grid-cols-2 gap-1.5">
            {data.materials.slice(0, 4).map(m => (
              <div key={m.id} className="aspect-square bg-bone overflow-hidden">
                {m.image_url && <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" />}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 4 - data.materials.length) }).map((_, i) => (
              <div key={`e${i}`} className="aspect-square bg-bone" />
            ))}
          </div>
        </Card>
        <Card label="Cabinetry & Hardware">
          <Detail
            product={data.cabinetProduct?.product}
            fallbackImage={data.cabinetMaterial?.image_url}
            fallbackName={data.cabinetMaterial?.name || "Cabinet finish + hardware"}
            fallbackSub={data.cabinetMaterial?.vendor}
          />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6 print:gap-3">
        <Card label="Countertop">
          <div className="flex gap-3">
            <div className="w-16 h-16 bg-bone overflow-hidden flex-shrink-0">
              {data.counter?.image_url && <img src={data.counter.image_url} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="min-w-0 self-center">
              <div className="font-display text-sm leading-tight">{data.counter?.name || "—"}</div>
              {data.counter?.vendor && <div className="text-[10px] text-muted-foreground mt-0.5">{data.counter.vendor}</div>}
            </div>
          </div>
        </Card>
        <Card label="Faucet">
          <Detail product={data.faucet?.product} fallbackName="Bridge faucet" />
        </Card>
      </div>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-border p-4 lg:p-5 print:p-3 bg-background">
      <div className="eyebrow text-[10px] mb-3">{label}</div>
      {children}
    </div>
  );
}

function Detail({ product, fallbackName, fallbackImage, fallbackSub }: { product?: any; fallbackName: string; fallbackImage?: string | null; fallbackSub?: string | null }) {
  const img = product?.image_url || fallbackImage;
  const sub = product?.finish || product?.vendor || fallbackSub;
  return (
    <div className="flex gap-3">
      <div className="w-16 h-16 bg-bone overflow-hidden flex-shrink-0">
        {img && <img src={img} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className="min-w-0 self-center">
        <div className="font-display text-sm leading-tight">{product?.name || fallbackName}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
