import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ArrowLeft, Eye, EyeOff, ExternalLink, MessageSquare, Radio } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { db, type MaterialItem, type Product, type Project, type Room, type RoomProduct } from "@/lib/db";
import { formatMoney, moneyValue } from "@/lib/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id/approvals")({
  head: () => ({ meta: [{ title: "Approval Setup — MERAV Studio" }] }),
  component: ApprovalSetupPage,
});

type SetupItem = RoomProduct & {
  room: Room;
  product: Product | null;
  material: MaterialItem | null;
};

type ApprovalDetailField =
  | "approval_show_vendor"
  | "approval_show_pricing"
  | "approval_show_quantity"
  | "approval_show_dimensions"
  | "approval_show_finish";

const DETAIL_VISIBILITY_CONTROLS: Array<{
  field: ApprovalDetailField;
  label: string;
}> = [
  { field: "approval_show_vendor", label: "Vendor" },
  { field: "approval_show_pricing", label: "Pricing" },
  { field: "approval_show_quantity", label: "Quantity" },
  { field: "approval_show_dimensions", label: "Dimensions" },
  { field: "approval_show_finish", label: "Color/Finish" },
];

function ApprovalSetupPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["approvalSetup", id],
    queryFn: async () => loadSetupData(id),
  });

  if (isLoading || !data) {
    return <AppShell><div className="p-16 text-muted-foreground">Loading approval setup...</div></AppShell>;
  }

  const { project, rooms, items } = data;
  const visibleRooms = rooms.filter((room) => room.approval_visible !== false).length;
  const visibleItems = items.filter((item) => item.approval_visible !== false && item.room.approval_visible !== false).length;
  const hiddenItems = items.length - visibleItems;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["approvalSetup", id] });
    qc.invalidateQueries({ queryKey: ["clientApprovals", id] });
    qc.invalidateQueries({ queryKey: ["project", id] });
  };

  const setRoomVisible = async (room: Room, visible: boolean) => {
    await db.updateRoom(room.id, { approval_visible: visible } as Partial<Room>);
    refresh();
    toast.success(visible ? `${room.name} is visible to clients` : `${room.name} is hidden from clients`);
  };

  const setItemVisible = async (item: SetupItem, visible: boolean) => {
    const { error } = await db.updateRoomProduct(item.id, { approval_visible: visible } as Partial<RoomProduct>);
    if (error) {
      toast.error(error.message || "Could not update approval visibility.");
      return;
    }
    refresh();
  };

  const setProjectDetailVisible = async (field: ApprovalDetailField, visible: boolean) => {
    await db.updateProject(id, { [field]: visible } as Partial<Project>);
    refresh();
    const control = DETAIL_VISIBILITY_CONTROLS.find((item) => item.field === field);
    toast.success(`${control?.label ?? "Detail"} ${visible ? "will show" : "will be hidden"} on the client approval page`);
  };

  const setApprovalLive = async (live: boolean) => {
    await db.updateProject(id, { approval_live: live } as Partial<Project>);
    refresh();
    toast.success(live ? "Approvals are now live for the client dashboard" : "Approvals are no longer live for the client dashboard");
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/projects/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Project
          </Link>
          <Link
            to="/client/approvals/$projectId"
            params={{ projectId: id }}
            className="inline-flex items-center justify-center gap-2 border border-ink px-4 py-2.5 text-sm text-ink transition-colors hover:bg-ink hover:text-primary-foreground"
          >
            <ExternalLink className="h-4 w-4" /> Open Client View
          </Link>
        </div>

        <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="eyebrow mb-3">Client Approvals</div>
            <h1 className="font-display text-5xl lg:text-6xl">Approval Setup</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Choose which rooms and selections appear on the client-facing approval page for {project.name}.
            </p>
          </div>
          <div className="flex flex-col items-start gap-4 lg:items-end">
            <LiveToggle live={project.approval_live === true} onToggle={() => setApprovalLive(project.approval_live !== true)} />
            <div className="grid grid-cols-3 gap-3">
              <SetupStat label="Visible Rooms" value={visibleRooms} />
              <SetupStat label="Visible Items" value={visibleItems} />
              <SetupStat label="Hidden Items" value={hiddenItems} />
            </div>
          </div>
        </div>

        <section className="mb-8 border border-border bg-card px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="eyebrow mb-2">Client Detail Visibility</div>
              <h2 className="font-display text-2xl">What Clients Can See</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {DETAIL_VISIBILITY_CONTROLS.map((control) => (
                <DetailVisibilityToggle
                  key={control.field}
                  label={control.label}
                  visible={project[control.field] !== false}
                  onToggle={() => setProjectDetailVisible(control.field, project[control.field] === false)}
                />
              ))}
            </div>
          </div>
        </section>

        <div className="space-y-6">
          {rooms.map((room) => {
            const roomItems = items.filter((item) => item.room_id === room.id);
            const roomVisible = room.approval_visible !== false;
            const visibleCount = roomItems.filter((item) => item.approval_visible !== false).length;
            return (
              <section key={room.id} className={cn("border border-border bg-card", !roomVisible && "opacity-70")}>
                <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="eyebrow mb-2">{visibleCount} of {roomItems.length} items visible</div>
                    <h2 className="font-display text-3xl">{room.name}</h2>
                  </div>
                  <VisibilityButton visible={roomVisible} onClick={() => setRoomVisible(room, !roomVisible)}>
                    {roomVisible ? "Room Visible" : "Room Hidden"}
                  </VisibilityButton>
                </div>

                {roomItems.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">No selections have been added to this room yet.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {roomItems.map((item) => (
                      <SetupItemRow
                        key={item.id}
                        item={item}
                        roomVisible={roomVisible}
                        onToggle={() => setItemVisible(item, item.approval_visible === false)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function DetailVisibilityToggle({
  label,
  visible,
  onToggle,
}: {
  label: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-2 border px-3.5 py-2 text-sm transition-colors",
        visible ? "border-ink bg-ink text-primary-foreground" : "border-border bg-background text-ink hover:border-ink",
      )}
    >
      {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      <span>{label}</span>
    </button>
  );
}

function LiveToggle({ live, onToggle }: { live: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-2 border px-4 py-2.5 text-sm transition-colors",
        live ? "border-[#3f7f47] bg-[#3f7f47] text-white" : "border-[#a33b35] bg-[#a33b35] text-white",
      )}
    >
      <Radio className="h-4 w-4" />
      <span>{live ? "Live" : "Not Live"}</span>
    </button>
  );
}

function SetupStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-card px-5 py-4 text-center">
      <div className="font-display text-3xl">{value}</div>
      <div className="eyebrow mt-1">{label}</div>
    </div>
  );
}

function SetupItemRow({ item, roomVisible, onToggle }: { item: SetupItem; roomVisible: boolean; onToggle: () => void }) {
  const detail = getSetupDetails(item);
  const visible = roomVisible && item.approval_visible !== false;
  return (
    <div className={cn("grid gap-4 p-5 md:grid-cols-[92px_1fr_auto] md:items-center", !visible && "bg-bone/40")}>
      <div className="flex h-20 w-20 items-center justify-center bg-bone">
        {detail.image ? <img src={detail.image} alt="" className="max-h-full max-w-full object-contain" /> : <EyeOff className="h-5 w-5 text-muted-foreground" />}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-ink">{detail.name}</h3>
          <span className="rounded-full bg-bone px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">{item.approval_status ?? "undecided"}</span>
          {item.approval_comment?.trim() && <span className="inline-flex items-center gap-1 rounded-full bg-bone px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground"><MessageSquare className="h-3 w-3" /> Comment</span>}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {detail.vendor || "No vendor"}{detail.total > 0 ? ` · ${formatMoney(detail.total)}` : ""}{detail.quantity ? ` · Qty ${detail.quantity}` : ""}
        </p>
      </div>
      <VisibilityButton visible={visible} disabled={!roomVisible} onClick={onToggle}>
        {!roomVisible ? "Room Hidden" : visible ? "Visible" : "Hidden"}
      </VisibilityButton>
    </div>
  );
}

function VisibilityButton({ visible, disabled, onClick, children }: { visible: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        visible ? "bg-ink text-primary-foreground" : "border border-border text-muted-foreground hover:border-ink hover:text-ink",
      )}
    >
      {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      {children}
    </button>
  );
}

async function loadSetupData(projectId: string) {
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

function getSetupDetails(item: SetupItem) {
  const product = item.product;
  const material = item.material;
  const quantity = material?.quantity && material.quantity > 0 ? material.quantity : 1;
  const price = moneyValue(product?.price);
  return {
    name: material?.client_product_name || product?.name || `${item.room.name} Selection`,
    image: product?.image_url,
    vendor: product?.vendor,
    quantity,
    total: price * quantity,
  };
}
