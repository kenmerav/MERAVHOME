import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, MessageSquare, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { db, type ApprovalStatus, type MaterialItem, type Product, type Project, type Room, type RoomProduct } from "@/lib/db";
import { formatMoney, moneyValue } from "@/lib/money";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/client/approvals/$projectId")({
  head: () => ({ meta: [{ title: "Client Approvals — MERAV Interiors" }] }),
  component: ClientApprovalsPage,
});

type ApprovalItem = RoomProduct & {
  room: Room;
  product: Product | null;
  material: MaterialItem | null;
};

function ClientApprovalsPage() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const [selectedRoomId, setSelectedRoomId] = useState<string>("overview");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  const { data: auth, isLoading: authLoading } = useQuery({
    queryKey: ["clientApprovalAuth"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      const profile = (await supabase.from("user_profiles").select("*").eq("id", data.session.user.id).maybeSingle()).data;
      return { session: data.session, profile };
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["clientApprovals", projectId],
    enabled: !!auth?.session,
    queryFn: async () => loadApprovalData(projectId),
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ item, status, comment }: { item: ApprovalItem; status: ApprovalStatus; comment?: string }) => {
      const { error } = await db.updateRoomProduct(item.id, {
        approval_status: status,
        approved: status === "approved",
        approval_comment: comment ?? item.approval_comment,
        approval_updated_at: new Date().toISOString(),
      } as Partial<RoomProduct>);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientApprovals", projectId] });
      qc.invalidateQueries({ queryKey: ["roomProducts"] });
    },
    onError: (error) => toast.error(error.message || "Could not save approval."),
  });

  if (authLoading || (auth?.session && isLoading)) {
    return <ClientFrame><div className="p-10 text-sm text-slate-500">Loading approvals...</div></ClientFrame>;
  }

  if (!auth?.session) {
    return (
      <ClientFrame>
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md rounded-[28px] bg-white p-10 text-center shadow-sm">
            <div className="font-display text-4xl">MERAV Interiors</div>
            <p className="mt-4 text-sm text-slate-500">Sign in to review and approve project selections.</p>
            <Link to="/login" className="mt-8 inline-flex rounded-full bg-slate-950 px-6 py-3 text-sm text-white">
              Sign in
            </Link>
          </div>
        </div>
      </ClientFrame>
    );
  }

  if (!data) {
    return <ClientFrame><div className="p-10 text-sm text-slate-500">Project approvals were not found.</div></ClientFrame>;
  }

  const { project, rooms, items } = data;
  const counts = countStatuses(items);
  const visibleItems = selectedRoomId === "overview" ? items : items.filter((item) => item.room_id === selectedRoomId);
  const selectedItem = selectedItemId ? items.find((item) => item.id === selectedItemId) ?? null : null;
  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;

  const openItem = (item: ApprovalItem) => {
    setSelectedItemId(item.id);
    setCommentDraft(item.approval_comment ?? "");
  };

  const setApproval = async (item: ApprovalItem, status: ApprovalStatus, comment?: string) => {
    await approvalMutation.mutateAsync({ item, status, comment });
    toast.success(status === "approved" ? "Selection approved" : status === "declined" ? "Selection declined" : "Selection updated");
  };

  const showPrevious = () => {
    if (selectedIndex <= 0) return;
    openItem(visibleItems[selectedIndex - 1]);
  };

  const showNext = () => {
    if (selectedIndex < 0 || selectedIndex >= visibleItems.length - 1) return;
    openItem(visibleItems[selectedIndex + 1]);
  };

  return (
    <ClientFrame>
      <div className="flex min-h-screen bg-[#f5f7f8] text-slate-800">
        <ClientSidebar
          project={project}
          rooms={rooms}
          items={items}
          selectedRoomId={selectedRoomId}
          onSelectRoom={(roomId) => setSelectedRoomId(roomId)}
        />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 lg:px-12">
          <div className="mx-auto max-w-[1680px]">
            <div className="mb-6 md:hidden">
              <div className="font-display text-2xl">MERAV Interiors</div>
              <select
                value={selectedRoomId}
                onChange={(event) => setSelectedRoomId(event.target.value)}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <option value="overview">Overview</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
            </div>

            <header className="rounded-[24px] bg-white px-6 py-8 shadow-sm md:px-10">
              <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Approval Portal</div>
                  <h1 className="mt-3 text-2xl font-bold uppercase tracking-tight text-slate-800 md:text-3xl">{project.name}</h1>
                  <p className="mt-2 text-sm text-slate-500">{project.client_name}</p>
                </div>
                <div className="grid grid-cols-3 gap-6 text-center">
                  <StatusMetric label="Undecided" value={counts.undecided} />
                  <StatusMetric label="Approved" value={counts.approved} />
                  <StatusMetric label="Declined" value={counts.declined} />
                </div>
              </div>
            </header>

            {selectedRoomId === "overview" ? (
              <OverviewGrid rooms={rooms} items={items} onSelectRoom={setSelectedRoomId} />
            ) : (
              <RoomApprovalGrid items={visibleItems} onOpen={openItem} onApprove={(item) => setApproval(item, "approved")} onDecline={(item) => setApproval(item, "declined")} />
            )}
          </div>
        </main>

        {selectedItem && (
          <ApprovalDetailModal
            item={selectedItem}
            commentDraft={commentDraft}
            onCommentChange={setCommentDraft}
            onClose={() => setSelectedItemId(null)}
            onPrevious={showPrevious}
            onNext={showNext}
            hasPrevious={selectedIndex > 0}
            hasNext={selectedIndex >= 0 && selectedIndex < visibleItems.length - 1}
            saving={approvalMutation.isPending}
            onApprove={() => setApproval(selectedItem, "approved", commentDraft)}
            onDecline={() => setApproval(selectedItem, "declined", commentDraft)}
            onSaveComment={() => setApproval(selectedItem, getStatus(selectedItem), commentDraft)}
          />
        )}
      </div>
    </ClientFrame>
  );
}

function ClientFrame({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#f5f7f8]">{children}</div>;
}

function ClientSidebar({
  project,
  rooms,
  items,
  selectedRoomId,
  onSelectRoom,
}: {
  project: Project;
  rooms: Room[];
  items: ApprovalItem[];
  selectedRoomId: string;
  onSelectRoom: (roomId: string) => void;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-80 shrink-0 flex-col border-r border-dashed border-slate-200 bg-white px-5 py-8 md:flex">
      <div>
        <div className="font-display text-3xl leading-none tracking-tight">MERAV INTERIORS</div>
        <div className="mt-1 text-[9px] uppercase tracking-[0.28em] text-slate-400">By Katie Roberts</div>
      </div>

      <nav className="mt-24 space-y-2 text-slate-500">
        <button type="button" className="flex w-full items-center gap-4 rounded-xl px-4 py-4 text-left text-base hover:bg-slate-50">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300">•</span>
          Welcome
        </button>
        <button type="button" className="flex w-full items-center justify-between rounded-xl bg-slate-100 px-4 py-4 text-left text-base text-slate-700">
          <span className="flex items-center gap-4"><CheckCircle2 className="h-6 w-6" /> Approval</span>
          <span>^</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectRoom("overview")}
          className={cn("ml-7 flex w-[calc(100%-1.75rem)] items-center gap-5 rounded-xl px-4 py-4 text-left text-base hover:bg-slate-50", selectedRoomId === "overview" && "bg-slate-100 text-slate-800")}
        >
          <span className="text-xl leading-none text-slate-300">•</span>
          Overview
        </button>
        {rooms.map((room) => {
          const roomCounts = countStatuses(items.filter((item) => item.room_id === room.id));
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => onSelectRoom(room.id)}
              className={cn("ml-7 flex w-[calc(100%-1.75rem)] items-center justify-between rounded-xl px-4 py-3 text-left text-base hover:bg-slate-50", selectedRoomId === room.id && "bg-slate-100 text-slate-800")}
            >
              <span className="flex min-w-0 items-center gap-5">
                <span className={cn("text-xl leading-none", selectedRoomId === room.id ? "text-[#27484b]" : "text-slate-300")}>•</span>
                <span className="truncate">{room.name}</span>
              </span>
              {roomCounts.undecided > 0 && <span className="text-xs text-slate-400">{roomCounts.undecided}</span>}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto text-sm text-slate-500">
        {project.name}
      </div>
    </aside>
  );
}

function StatusMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-slate-400">{value}</div>
      <div className="text-sm text-slate-700">{label}</div>
    </div>
  );
}

function OverviewGrid({ rooms, items, onSelectRoom }: { rooms: Room[]; items: ApprovalItem[]; onSelectRoom: (roomId: string) => void }) {
  return (
    <section className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {rooms.map((room) => {
        const roomItems = items.filter((item) => item.room_id === room.id);
        const firstImage = roomItems.find((item) => item.product?.image_url)?.product?.image_url;
        const counts = countStatuses(roomItems);
        return (
          <button
            key={room.id}
            type="button"
            onClick={() => onSelectRoom(room.id)}
            className="group rounded-[22px] bg-white p-8 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex h-56 items-center justify-center">
              {firstImage ? (
                <img src={firstImage} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-full bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-300">No Image</div>
              )}
            </div>
            <h2 className="mt-8 text-lg font-semibold text-slate-800">{room.name}</h2>
            <p className="mt-7 text-sm text-slate-600">{counts.undecided} Need Approval</p>
          </button>
        );
      })}
    </section>
  );
}

function RoomApprovalGrid({
  items,
  onOpen,
  onApprove,
  onDecline,
}: {
  items: ApprovalItem[];
  onOpen: (item: ApprovalItem) => void;
  onApprove: (item: ApprovalItem) => void;
  onDecline: (item: ApprovalItem) => void;
}) {
  if (!items.length) {
    return (
      <div className="mt-8 rounded-[22px] bg-white p-12 text-center text-sm text-slate-500 shadow-sm">
        No selections have been added for this room yet.
      </div>
    );
  }

  return (
    <section className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {items.map((item) => {
        const detail = getDisplayDetails(item);
        const status = getStatus(item);
        return (
          <article key={item.id} className="rounded-[22px] bg-white p-7 shadow-sm">
            <button type="button" onClick={() => onOpen(item)} className="block w-full text-left">
              <div className="flex h-56 items-center justify-center">
                {detail.image ? (
                  <img src={detail.image} alt={detail.name} className="max-h-full max-w-full object-contain" />
                ) : (
                  <div className="flex h-32 w-32 items-center justify-center rounded-full bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-300">No Image</div>
                )}
              </div>
              <h2 className="mt-8 min-h-14 text-base font-bold leading-snug text-slate-800">{detail.name}</h2>
              {detail.total > 0 && <p className="mt-5 text-base font-bold text-slate-800">{formatMoney(detail.total)}</p>}
              <p className="mt-2 text-sm text-slate-500">Qty: {detail.quantity}</p>
            </button>
            <div className="mt-6 flex items-center justify-between gap-4">
              <button type="button" onClick={() => onOpen(item)} className="text-slate-500 hover:text-[#27484b]" aria-label="Open comments">
                <MessageSquare className={cn("h-5 w-5", item.approval_comment && "fill-[#27484b]/10 text-[#27484b]")} />
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">{formatShortDate(item.approval_updated_at)}</span>
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => onApprove(item)}
                    className={cn("flex h-12 w-14 items-center justify-center transition", status === "approved" ? "bg-[#48a23f] text-white" : "bg-white text-slate-400 hover:bg-[#48a23f] hover:text-white")}
                    aria-label="Approve"
                  >
                    <Check className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecline(item)}
                    className={cn("flex h-12 w-14 items-center justify-center border-l border-slate-200 transition", status === "declined" ? "bg-slate-600 text-white" : "bg-white text-slate-400 hover:bg-slate-600 hover:text-white")}
                    aria-label="Decline"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ApprovalDetailModal({
  item,
  commentDraft,
  onCommentChange,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  saving,
  onApprove,
  onDecline,
  onSaveComment,
}: {
  item: ApprovalItem;
  commentDraft: string;
  onCommentChange: (value: string) => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  saving: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onSaveComment: () => void;
}) {
  const detail = getDisplayDetails(item);
  const status = getStatus(item);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 md:p-5">
      <div className="relative h-full overflow-y-auto rounded-none bg-white p-6 shadow-2xl md:rounded-[24px] md:p-10">
        <button type="button" onClick={onClose} className="absolute right-6 top-6 text-slate-500 hover:text-slate-900" aria-label="Close">
          <X className="h-7 w-7" />
        </button>
        <div className="grid min-h-full gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <section>
            <div className="flex flex-col gap-4 pr-12 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-2xl font-bold text-slate-800">{detail.name}</h2>
              <div className="inline-flex w-fit items-center gap-3">
                <span className="text-sm text-slate-500">{formatShortDate(item.approval_updated_at)}</span>
                <ApprovalPill status={status} />
              </div>
            </div>
            <div className="relative mt-10 flex min-h-[420px] items-center justify-center">
              <button
                type="button"
                disabled={!hasPrevious}
                onClick={onPrevious}
                className="absolute left-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 disabled:opacity-25"
                aria-label="Previous item"
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
              {detail.image ? (
                <img src={detail.image} alt={detail.name} className="max-h-[560px] max-w-[78%] object-contain" />
              ) : (
                <div className="flex h-48 w-48 items-center justify-center rounded-full bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-300">No Image</div>
              )}
              <button
                type="button"
                disabled={!hasNext}
                onClick={onNext}
                className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 disabled:opacity-25"
                aria-label="Next item"
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            </div>
            {detail.image && (
              <div className="mt-8 flex justify-center">
                <div className="h-24 w-24 rounded-xl border border-slate-200 p-2">
                  <img src={detail.image} alt="" className="h-full w-full object-contain" />
                </div>
              </div>
            )}
          </section>

          <aside className="flex flex-col justify-center lg:pr-20">
            <div className="space-y-6 text-xl text-slate-700">
              <DetailLine label="Room" value={item.room.name} />
              <DetailLine label="Vendor" value={detail.vendor} />
              <DetailLine label="Price per Item" value={detail.price > 0 ? formatMoney(detail.price) : null} />
              <DetailLine label="Qty" value={`${detail.quantity} Item(s)`} />
              <DetailLine label="Total Price" value={detail.total > 0 ? formatMoney(detail.total) : null} />
              <DetailLine label="Dimensions" value={detail.dimensions} />
              <DetailLine label="Color/Finish" value={detail.colorFinish} />
            </div>

            <div className="mt-10 rounded-[22px] bg-slate-100 p-6">
              <label className="text-base text-slate-500" htmlFor="client-comment">Client Comments</label>
              <textarea
                id="client-comment"
                value={commentDraft}
                onChange={(event) => onCommentChange(event.target.value)}
                placeholder="Leave a note for the design team..."
                className="mt-5 min-h-28 w-full resize-none border-0 border-b border-slate-300 bg-transparent text-lg outline-none focus:border-slate-700"
              />
              <p className="mt-4 text-sm text-slate-500">Updated: {formatLongDate(item.approval_updated_at)}</p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button type="button" disabled={saving} onClick={onApprove} className="rounded-xl bg-[#48a23f] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
                Approve
              </button>
              <button type="button" disabled={saving} onClick={onDecline} className="rounded-xl bg-slate-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
                Decline
              </button>
              <button type="button" disabled={saving} onClick={onSaveComment} className="rounded-xl bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
                Save
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-slate-500">{label}: </span>
      <span className="font-bold text-slate-800">{value}</span>
    </div>
  );
}

function ApprovalPill({ status }: { status: ApprovalStatus }) {
  if (status === "approved") {
    return <span className="inline-flex items-center gap-2 rounded-lg bg-[#48a23f] px-4 py-2 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4" /> Approved</span>;
  }
  if (status === "declined") {
    return <span className="inline-flex items-center gap-2 rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white"><XCircle className="h-4 w-4" /> Declined</span>;
  }
  return <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">Undecided</span>;
}

async function loadApprovalData(projectId: string) {
  const [project, rooms, materialItems] = await Promise.all([
    db.getProject(projectId),
    db.listRooms(projectId),
    db.listMaterialItemsByProject(projectId),
  ]);
  if (!project) throw new Error("Project not found.");

  const roomList = rooms ?? [];
  const materials = materialItems ?? [];
  const materialMap = new Map<string, MaterialItem>();
  materials.forEach((material) => {
    if (material.product_id) materialMap.set(`${material.room_id}::${material.product_id}`, material);
  });

  const roomProducts = await Promise.all(
    roomList.map(async (room) => {
      const selections = (await db.listRoomProducts(room.id)) ?? [];
      return selections.map((selection) => ({
        ...selection,
        room,
        product: selection.product ?? null,
        material: materialMap.get(`${room.id}::${selection.product_id}`) ?? null,
      }));
    }),
  );

  return {
    project,
    rooms: roomList,
    items: roomProducts.flat().sort((a, b) => a.room.sort_order - b.room.sort_order || a.sort_order - b.sort_order),
  };
}

function countStatuses(items: ApprovalItem[]) {
  return items.reduce(
    (counts, item) => {
      counts[getStatus(item)] += 1;
      return counts;
    },
    { undecided: 0, approved: 0, declined: 0 } as Record<ApprovalStatus, number>,
  );
}

function getStatus(item: ApprovalItem): ApprovalStatus {
  return item.approval_status ?? (item.approved ? "approved" : "undecided");
}

function getDisplayDetails(item: ApprovalItem) {
  const product = item.product;
  const material = item.material;
  const quantity = material?.quantity && material.quantity > 0 ? material.quantity : 1;
  const price = moneyValue(product?.price);
  const colorFinish = [material?.color, product?.finish].filter(Boolean).join(" / ");

  return {
    name: material?.client_product_name || product?.name || `${item.room.name} Selection`,
    image: product?.image_url,
    vendor: product?.vendor,
    price,
    quantity,
    total: price * quantity,
    dimensions: product?.dimensions,
    colorFinish: colorFinish || null,
  };
}

function formatShortDate(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatLongDate(value?: string | null) {
  if (!value) return "Not saved yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
