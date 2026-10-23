import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccuracyItemEditor, DesignAccuracyPanel } from "./DesignAccuracyPanel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { accuracyImportCommands, accuracyRoomSelections } from "@/lib/designAccuracyProjection";
import { accuracyItemIssues, type AccuracySource, type AccuracyState } from "@/lib/designAccuracy";
import type { RoomDesignSelection } from "@/lib/roomDesignWorkflow";
import { updateRoomDetail } from "@/lib/roomDesignDetails";
import type { AccuracyCommand } from "@/lib/designAccuracy";
import {
  RoomDesignAccuracyContext,
  RoomDesignAccuracyRoomContext,
  useRoomDesignAccuracy,
  useRoomDesignAccuracyRoom,
} from "@/lib/roomDesignAccuracyContext";

export function RoomDesignAccuracyRoom({
  roomId,
  children,
}: {
  roomId: string;
  children: ReactNode;
}) {
  return (
    <RoomDesignAccuracyRoomContext.Provider value={roomId}>
      {children}
    </RoomDesignAccuracyRoomContext.Provider>
  );
}

export function RoomDesignAccuracyProvider({
  projectId,
  fixture = false,
  children,
}: {
  projectId: string;
  fixture?: boolean;
  children: ReactNode;
}) {
  return (
    <DesignAccuracyPanel projectId={projectId} fixture={fixture}>
      {(controller) => (
        <RoomDesignAccuracyContext.Provider value={controller}>
          {children}
        </RoomDesignAccuracyContext.Provider>
      )}
    </DesignAccuracyPanel>
  );
}

/** One batch per room, rather than competing per-card writes. Imported facts stay unconfirmed. */
export function RoomDesignAccuracySync({
  roomId,
  selections,
}: {
  roomId: string;
  selections: RoomDesignSelection[];
}) {
  const controller = useRoomDesignAccuracy();
  const attempted = useRef("");
  useEffect(() => {
    if (!controller?.state || controller.busy) return;
    const commands = accuracyImportCommands(controller.state, roomId, selections);
    if (!commands.length) {
      attempted.current = "";
      return;
    }
    const key = JSON.stringify([roomId, commands]);
    if (attempted.current === key) return;
    const timer = window.setTimeout(() => {
      attempted.current = key;
      void controller.mutate(commands).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [controller, roomId, selections]);
  return null;
}

export function RoomDesignAccuracyNotice() {
  const controller = useRoomDesignAccuracy();
  if (!controller?.loaded) return null;
  return (
    <div className="my-4 space-y-2 text-sm">
      {!controller.state && !controller.error && (
        <Button
          variant="outline"
          size="sm"
          disabled={controller.busy}
          onClick={() => void controller.enable()}
        >
          Enable required product details for this project
        </Button>
      )}
      {controller.state && (
        <p className="text-muted-foreground">
          Add your product links as usual. Review products to fill in and confirm the required
          details on each item.
        </p>
      )}
      {controller.error && (
        <p role="alert" className="text-amber-900">
          {controller.error}{" "}
          <button className="underline" onClick={() => void controller.reload()}>
            Reload saved details
          </button>
        </p>
      )}
    </div>
  );
}

export function RoomDesignAccuracyProjectOptions({
  projectId,
  roomId,
  fixture = false,
  materials = [],
}: {
  projectId: string;
  roomId: string;
  fixture?: boolean;
  materials?: { id: string; room_id: string; item_label: string }[];
}) {
  const controller = useRoomDesignAccuracy();
  const [open, setOpen] = useState(false);
  if (!controller?.state) return null;
  return (
    <details
      className="my-4 text-sm"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted-foreground">
        Room scope, project defaults & drawing checks
      </summary>
      {open && (
        <DesignAccuracyPanel
          projectId={projectId}
          roomId={roomId}
          fixture={fixture}
          materials={materials}
          onState={controller.acceptState}
        />
      )}
    </details>
  );
}

export function RoomDesignNotNeededButton({
  category,
  selectionId,
  notNeeded = false,
  onChange,
}: {
  category: string;
  selectionId: string;
  notNeeded?: boolean;
  onChange?: (notNeeded: boolean) => void;
}) {
  const controller = useRoomDesignAccuracy();
  const roomId = useRoomDesignAccuracyRoom();
  const item = controller?.state?.rooms
    .find((r) => r.id === roomId)
    ?.items.find(
      (i) =>
        i.selectionId === selectionId ||
        i.selectionId === `link-${selectionId}` ||
        (!i.selectionId && i.category.toLowerCase() === category.toLowerCase()),
    );
  const excluded = notNeeded || item?.decision?.disposition === "not-needed";
  const toggle = async () => {
    if (controller?.state) {
      const id = item?.id ?? `${roomId}:checklist:${selectionId}`;
      const previous = item?.decisionHistory.filter((d) => d.disposition !== "not-needed").at(-1);
      const commands: AccuracyCommand[] = item
        ? []
        : [{ type: "item", roomId, id, category, kind: "retail", sizeRequired: false }];
      commands.push({
        type: "decision",
        roomId,
        itemId: id,
        disposition: excluded
          ? (previous?.disposition ?? (item?.selectionId ? "select" : "unresolved"))
          : "not-needed",
        ...(excluded && previous
          ? {
              owner: previous.owner,
              parentId: previous.parentId,
              source: previous.source,
              meravFields: previous.meravFields,
            }
          : {}),
      });
      await controller.mutate(commands);
    }
    onChange?.(!excluded);
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={controller?.busy}
      aria-label={`${excluded ? "Restore" : "Mark"} ${category}${excluded ? "" : " not needed"}`}
      onClick={() => void toggle().catch(() => {})}
    >
      {excluded ? "Restore item" : "Not needed"}
    </Button>
  );
}

export function RoomDesignAccuracyItem({
  selection,
  onUpdate,
}: {
  selection: RoomDesignSelection;
  onUpdate: (id: string, patch: Partial<RoomDesignSelection>) => void;
}) {
  const controller = useRoomDesignAccuracy();
  const [reference, setReference] = useState("");
  const [kind, setKind] = useState<AccuracySource["kind"]>("supplier");
  const sourceId = useRef(crypto.randomUUID());
  const roomId = useRoomDesignAccuracyRoom();
  const room = controller?.state?.rooms.find((r) => r.id === roomId);
  const item = room?.items.find((i) => i.selectionId === selection.id);
  if (!controller?.state) return null;
  if (!room || !item)
    return <p className="text-xs text-muted-foreground">Preparing this item’s required details…</p>;
  const issues = accuracyItemIssues(controller.state, item);
  const excluded = item.decision?.disposition === "not-needed";
  const apply = (state: AccuracyState) => {
    const [updated] = accuracyRoomSelections(state, room.id, [selection]);
    onUpdate(selection.id, updated);
  };
  return (
    <section
      className="min-w-0 border border-border bg-bone/15 p-4"
      aria-label={`${selection.category} required details`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">
          {excluded
            ? "Not needed for this room"
            : issues.length
              ? "Complete this item’s details"
              : "Item details confirmed"}
        </h3>
        <RoomDesignNotNeededButton
          category={selection.category}
          selectionId={selection.id}
          onChange={(notNeeded) =>
            onUpdate(selection.id, {
              notes: updateRoomDetail(
                selection.notes,
                "Selection responsibility",
                notNeeded ? "Not needed" : "Choose product",
              ),
              state: notNeeded ? "draft" : "selected",
            })
          }
        />
      </div>
      {excluded ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This item is excluded from the room’s required selections. Its saved details are kept so
          you can restore it.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Check the exact selected product and enter anything the link did not provide. Prices can
            stay blank during design.
          </p>
          {selection.url && (
            <a
              href={selection.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs underline"
            >
              Open selected product link ↗
            </a>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
            <label className="text-xs">
              Confirm using
              <select
                className="mt-1 block w-full border border-border bg-background p-2"
                value={kind}
                onChange={(e) => setKind(e.target.value as AccuracySource["kind"])}
              >
                <option value="supplier">Supplier / product page</option>
                <option value="sample">Approved sample</option>
                <option value="designer">Designer decision</option>
                <option value="schedule">Quantity schedule</option>
              </select>
            </label>
            <label className="text-xs">
              What confirms these details?
              <Input
                className="mt-1"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Exact finish/model on product page, approved sample, or schedule row"
              />
            </label>
          </div>
          <AccuracyItemEditor
            key={item.id}
            state={controller.state}
            room={room}
            item={item}
            busy={controller.busy}
            mutate={controller.mutate}
            materials={[]}
            compact
            confirmationReady={reference.trim().length >= 8}
            onSaved={apply}
            source={() => ({
              id: sourceId.current,
              kind,
              label: `${selection.category} ${kind === "supplier" ? "product page" : "reference"}`,
              revision: "1",
              reference: reference.trim(),
            })}
          />
        </>
      )}
    </section>
  );
}
