import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublishedProductColorInput } from "./PublishedProductColorInput";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/db";
import {
  accuracyHandoff,
  accuracyImportCommands,
  accuracyRoomSelections,
} from "@/lib/designAccuracyProjection";
import type { RoomDesignSelection } from "@/lib/roomDesignWorkflow";
import {
  ACCURACY_UNITS,
  accuracyCheckStatus,
  accuracyItemIssues,
  accuracyOutputs,
  accuracyProgress,
  fieldConfirmed,
  requiredAccuracyFields,
  snapshotChanged,
  valueOf,
  type AccuracyCommand,
  type AccuracyItem,
  type AccuracyRoom,
  type AccuracySource,
  type AccuracyState,
  type AccuracyValue,
  type Disposition,
} from "@/lib/designAccuracy";

const ACCURACY_FIELD_LABELS: Record<string, string> = {
  manufacturer: "Actual manufacturer / brand",
  supplierColor: "Cited exact variant color (from supplier evidence)",
  productName: "Product family / name",
  sku: "Exact model or variant SKU",
  color: "Selected color / stain",
  location: "Application / location",
  finishCodeOrSample: "Finish code or approved sample",
  finishType: "Stock or custom finish",
  finishCodeAvailable: "Manufacturer provides a finish code? (yes / no)",
  quantity: "Required design quantity",
  quantityUnit: "Design quantity unit",
  quantityBasis: "Count / layout / schedule reference",
  selectedSize: "Exact selected size",
  customId: "Project custom item identifier",
  specification: "Approved custom specification",
  documentation: "Sample / drawing / supplier reference",
  url: "Exact variant link",
  imageUrl: "Representative image link",
  overallDimensions: "Overall product dimensions",
  mountingCenters: "Mounting centers",
  cutout: "Required cutout",
  installation: "Installation constraints",
  dimensionClarification: "Overall length versus mounting centers clarification",
  owner: "Cabinet person / responsible specialist",
  coordinationReference: "Shop drawing / coordination reference",
  colorCode: "Paint color code",
  sheen: "Sheen",
  grout: "Grout color / product",
  joint: "Joint width",
  layout: "Layout",
  direction: "Direction",
  edge: "Edge detail",
  thickness: "Thickness",
  overhang: "Overhang",
  fieldRequired: "Field takeoff required? (yes / no)",
  fieldTakeoff: "GC / trade confirmation reference",
  purchaseUnit: "Purchase unit",
  wastePercent: "Approved waste / spares %",
  packCoverage: "Coverage per purchase unit",
  coverageUnit: "Coverage measurement unit",
  sellingIncrement: "Selling increment",
  price: "Unit price (optional at design stage)",
  priceUnit: "Price basis (separate from design unit)",
  installationId: "Unique installation ID (reuse across duplicate views)",
  sharedProductId: "Shared total selection ID",
  quantityRole: "independent / shared-total / allocation",
  notes: "Design notes",
  surfaceFinish: "Published surface finish",
};
const SELECT_LABELS: [Disposition, string][] = [
  ["unresolved", "Unresolved / TBD"],
  ["select", "Selected / being selected"],
  ["not-needed", "Not needed"],
  ["existing", "Existing / keep"],
  ["other-party", "By another party"],
  ["included", "Included in another item"],
];
const numericFields = new Set([
  "quantity",
  "wastePercent",
  "packCoverage",
  "sellingIncrement",
  "price",
  "width",
  "depth",
  "height",
  "openingWidth",
]);
const blankSource = (): AccuracySource => ({
  id: "",
  kind: "designer",
  label: "",
  revision: "1",
  reference: "",
});

export type DesignAccuracyController = {
  state: AccuracyState | null;
  loaded: boolean;
  busy: boolean;
  error: string;
  mutate: (commands: AccuracyCommand[], base?: AccuracyState) => Promise<AccuracyState>;
  enable: () => Promise<void>;
  reload: () => Promise<void>;
  acceptState: (state: AccuracyState | null) => void;
};

export function DesignAccuracyPanel({
  projectId,
  roomId,
  fixture = false,
  onState,
  draftSelections,
  onApplySelections,
  materials = [],
  children,
}: {
  projectId: string;
  roomId?: string;
  fixture?: boolean;
  onState?: (state: AccuracyState | null) => void;
  draftSelections?: RoomDesignSelection[];
  onApplySelections?: (selections: RoomDesignSelection[]) => void;
  materials?: { id: string; room_id: string; item_label: string }[];
  children?: (controller: DesignAccuracyController) => ReactNode;
}) {
  const [state, setState] = useState<AccuracyState | null>(null);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [activeRoom, setActiveRoom] = useState(roomId ?? ""),
    [expanded, setExpanded] = useState<string | null>(null),
    [showExcluded, setShowExcluded] = useState(false);
  const [source, setSource] = useState<AccuracySource>(blankSource);
  const [missingRoom, setMissingRoom] = useState("");
  const [roomScope, setRoomScope] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [extraction, setExtraction] = useState<unknown>(null);
  const [documents, setDocuments] = useState<{ id: string; title: string; updated_at: string }[]>(
    [],
  );
  const [selectedDocument, setSelectedDocument] = useState("");
  const [defaultKey, setDefaultKey] = useState("grout"),
    [defaultValue, setDefaultValue] = useState("");
  const latestRevision = useRef({ projectId, revision: -1 });
  const initializedScope = useRef("");

  const request = useCallback(
    async (input?: unknown) => {
      const token = fixture ? "" : (await supabase.auth.getSession()).data.session?.access_token;
      const response = await fetch(
        `/api/design-accuracy?projectId=${encodeURIComponent(projectId)}`,
        {
          method: input ? "POST" : "GET",
          cache: "no-store",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(input ? { "Content-Type": "application/json" } : {}),
          },
          ...(input ? { body: JSON.stringify(input) } : {}),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save design decisions.");
      return body;
    },
    [projectId, fixture],
  );
  const receive = useCallback(
    (body: { state?: AccuracyState }) => {
      if (latestRevision.current.projectId !== projectId)
        latestRevision.current = { projectId, revision: -1 };
      if (body.state) {
        if (
          body.state.projectId !== projectId ||
          body.state.revision < latestRevision.current.revision
        )
          return;
        latestRevision.current.revision = body.state.revision;
        setState(body.state);
        onState?.(body.state);
      } else {
        if (latestRevision.current.revision >= 0) return;
        setState(null);
        onState?.(null);
      }
      setLoaded(true);
    },
    [projectId, onState],
  );
  const reload = useCallback(async () => {
    setError("");
    try {
      const body = await request();
      receive(body);
    } catch (e) {
      setError(String((e as Error).message));
      setLoaded(true);
    }
  }, [request, receive]);
  const acceptState = useCallback(
    (next: AccuracyState | null) => receive(next ? { state: next } : {}),
    [receive],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (roomId) setActiveRoom(roomId);
  }, [roomId]);
  useEffect(() => {
    if (!state) return;
    setActiveRoom((current) => current || state.rooms[0]?.id || "");
    const key = `${state.projectId}:${state.scopeConfirmation?.at || "unconfirmed"}`;
    if (initializedScope.current === key) return;
    initializedScope.current = key;
    setRoomScope(state.agreedRooms.map((r) => r.id));
    setMissingRoom(
      state.agreedRooms
        .filter((r) => !state.rooms.some((existing) => existing.id === r.id))
        .map((r) => r.name)
        .join("\n"),
    );
  }, [state]);

  const mutate = async (commands: AccuracyCommand[], base = state) => {
    if (!base) throw new Error("Opt the project in first.");
    setBusy(true);
    setError("");
    try {
      const body = await request({ expectedRevision: base.revision, commands });
      receive(body);
      return body.state as AccuracyState;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const run = (commands: AccuracyCommand[]) => {
    void mutate(commands).catch(() => {});
  };
  const currentSource = (): AccuracySource => ({ ...source, id: source.id || crypto.randomUUID() });
  const sourceForm = (
    <div className="grid gap-3 border border-border bg-bone/20 p-4 sm:grid-cols-2">
      <label className="text-xs">
        Reference type
        <select
          className="mt-1 block w-full border border-border bg-background p-2"
          value={source.kind}
          onChange={(e) => setSource({ ...source, kind: e.target.value as AccuracySource["kind"] })}
        >
          {[
            "designer",
            "supplier",
            "sample",
            "layout",
            "schedule",
            "brief",
            "document",
            "default",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        Source name
        <Input
          value={source.label}
          placeholder="Cabinet schedule / approved sample / design brief"
          onChange={(e) => setSource({ ...source, label: e.target.value })}
        />
      </label>
      <label className="text-xs">
        Revision
        <Input
          value={source.revision}
          onChange={(e) => setSource({ ...source, revision: e.target.value })}
        />
      </label>
      <label className="text-xs">
        Meaningful reference or named decision
        <Input
          value={source.reference}
          placeholder="Sheet K-4, hardware schedule, rows 2–8"
          onChange={(e) => setSource({ ...source, reference: e.target.value })}
        />
      </label>
      {source.kind === "document" && (
        <>
          <label className="text-xs">
            Document ID
            <Input
              value={source.documentId ?? ""}
              onChange={(e) => setSource({ ...source, documentId: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Sheet / callout
            <Input
              value={source.sheet ?? ""}
              onChange={(e) => setSource({ ...source, sheet: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Physical PDF page
            <Input
              type="number"
              min="1"
              value={source.page ?? ""}
              onChange={(e) => setSource({ ...source, page: Number(e.target.value) || undefined })}
            />
          </label>
        </>
      )}
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Your identity, time, values and selection version are recorded on confirmation. Reuse a
        schedule or approved brief across the relevant decisions.
      </p>
    </div>
  );

  if (children)
    return children({
      state,
      loaded,
      busy,
      error,
      mutate,
      reload,
      acceptState,
      enable: async () => {
        setBusy(true);
        setError("");
        try {
          receive(await request({ action: "enable" }));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      },
    });
  if (!loaded) return <p className="my-5 text-sm">Loading design decisions…</p>;
  if (!state)
    return (
      <section className="my-5 border border-border p-5">
        <h2 className="font-display text-2xl">Design decision checks</h2>
        <p className="my-3 text-sm text-muted-foreground">
          Opt this project in to track agreed room scope, exact selections and their evidence.
          Existing selections enter as unconfirmed drafts.
        </p>
        <Button
          disabled={busy || Boolean(error)}
          onClick={() => {
            setBusy(true);
            void request({ action: "enable" })
              .then(receive)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Enable for this project
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-amber-800">
            {error}
          </p>
        )}
      </section>
    );
  const room = state.rooms.find((r) => r.id === activeRoom) ?? state.rooms[0];
  const progress = accuracyProgress(state, room?.id),
    projectProgress = accuracyProgress(state);
  const excluded = room?.items.filter((i) => i.decision?.disposition === "not-needed") ?? [];
  const items =
    room?.items.filter((i) => showExcluded || i.decision?.disposition !== "not-needed") ?? [];
  const download = (kind: "board" | "spec" | "drawing-handoff") => {
    const blob = new Blob([JSON.stringify(accuracyHandoff(state, kind), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `${kind}-design-draft-r${state.revision}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      className="my-5 min-w-0 space-y-5 border border-border bg-background p-4 md:p-6 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:h-auto [&_button]:min-h-9 [&_select]:min-w-0 [&_select]:max-w-full [&_label]:min-w-0"
      aria-label="Design decision checks"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">
            {fixture ? "LOCAL TEST PROJECT · NO LIVE DATA" : "Project opt-in"}
          </div>
          <h2 className="mt-2 font-display text-3xl">Design decisions</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Resolve the applicable choices as you design. Boards and draft outputs stay available
            while coordination is pending.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void reload()}>
          Reload saved version
        </Button>
      </header>
      {error && (
        <p role="alert" className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {error} Your unsaved edits remain in the open card.
        </p>
      )}
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {[
          [
            "Selected products reviewed",
            `${progress.selectedReviewed} / ${progress.selectedTotal}`,
          ],
          ["Room requirements resolved", `${progress.resolved} / ${progress.total}`],
          [
            "Drawing coordination",
            progress.drawing === "checked-requirements-only"
              ? "Matches checked requirements only"
              : progress.drawing === "pending"
                ? "Pending evidence"
                : "Review needed",
          ],
          ["External / field dependencies", String(progress.external.length)],
          ["Procurement", progress.procurementReady ? "Ready for checked items" : "Pending"],
        ].map(([label, value]) => (
          <div key={label} className="border border-border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-2 font-medium">{value}</div>
          </div>
        ))}
      </div>
      <p role="status" className="text-sm">
        Merav design:{" "}
        <strong>
          {projectProgress.designComplete
            ? "Complete for confirmed scope"
            : "Decisions outstanding"}
        </strong>{" "}
        · Saved revision {state.revision}
      </p>
      <details className="border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Agreed project scope & reusable evidence
        </summary>
        <div className="mt-4 space-y-4">
          {sourceForm}
          {!!state.sources.length && (
            <label className="block text-sm">
              Use an existing reference
              <select
                className="mt-2 block w-full border border-border p-2"
                value={source.id}
                onChange={(e) =>
                  setSource(state.sources.find((s) => s.id === e.target.value) ?? blankSource())
                }
              >
                <option value="">New reference</option>
                {state.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} · {s.revision}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              const s = currentSource();
              setSource(s);
              run([{ type: "source", source: s }]);
            }}
          >
            Save / revise reusable source
          </Button>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs">
              Project default field
              <Input
                value={defaultKey}
                onChange={(e) => setDefaultKey(e.target.value)}
                placeholder="grout / joint / layout / sheen"
              />
            </label>
            <label className="text-xs">
              Proposed default answer
              <Input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} />
            </label>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                const s = { ...currentSource(), kind: "default" as const };
                setSource(s);
                run([
                  {
                    type: "default",
                    id: `${s.id}:${defaultKey}`,
                    key: defaultKey,
                    value: defaultValue,
                    source: s,
                  },
                ]);
              }}
            >
              Save proposed project default
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Check against the agreed brief, including rooms that have not yet been entered.
          </p>
          <div className="flex flex-wrap gap-4">
            {state.rooms.map((r) => (
              <label key={r.id} className="text-sm">
                <input
                  type="checkbox"
                  checked={roomScope.includes(r.id)}
                  onChange={(e) =>
                    setRoomScope(
                      e.target.checked
                        ? [...roomScope, r.id]
                        : roomScope.filter((id) => id !== r.id),
                    )
                  }
                />{" "}
                {r.name}
              </label>
            ))}
          </div>
          <label className="block text-sm">
            Additional in-scope rooms missing from Studio (one per line)
            <textarea
              className="mt-2 block w-full border border-border p-2"
              value={missingRoom}
              onChange={(e) => setMissingRoom(e.target.value)}
            />
          </label>
          <Button
            disabled={busy}
            onClick={() =>
              run([
                {
                  type: "scope",
                  rooms: [
                    ...state.rooms
                      .filter((r) => roomScope.includes(r.id))
                      .map((r) => ({ id: r.id, name: r.name })),
                    ...missingRoom
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((name) => ({ id: `unentered:${name.toLowerCase()}`, name })),
                  ],
                  source: currentSource(),
                },
              ])
            }
          >
            Confirm agreed room scope
          </Button>
          {!progress.scopeConfirmed && (
            <p className="text-sm text-amber-800">Agreed room coverage has not been confirmed.</p>
          )}
          {!!progress.missingRooms.length && (
            <p className="text-sm text-amber-800">
              Missing rooms: {progress.missingRooms.map((r) => r.name).join(", ")}
            </p>
          )}
        </div>
      </details>
      <div className="flex flex-wrap items-end gap-3">
        {draftSelections?.length && room ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(accuracyImportCommands(state, room.id, draftSelections))}
          >
            Read current product cards as proposals
          </Button>
        ) : null}
        {onApplySelections && draftSelections && room && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              onApplySelections(accuracyRoomSelections(state, room.id, draftSelections))
            }
          >
            Apply decisions to room product cards
          </Button>
        )}
        {!roomId && (
          <label className="text-sm">
            Room
            <select
              className="mt-1 block border border-border p-2"
              value={room?.id}
              onChange={(e) => {
                setActiveRoom(e.target.value);
                setExpanded(null);
              }}
            >
              {state.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => room && run([{ type: "no-tub", roomId: room.id }])}
        >
          No tub
        </Button>
        <Button variant="ghost" onClick={() => setShowExcluded(!showExcluded)}>
          {showExcluded ? "Hide" : "Inspect"} Not needed ({excluded.length})
        </Button>
      </div>
      <div className="divide-y divide-border border border-border">
        {items.map((item) => {
          const issues = accuracyItemIssues(state, item),
            open = expanded === item.id;
          return (
            <article key={item.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  className="text-left"
                  onClick={() => setExpanded(open ? null : item.id)}
                  aria-expanded={open}
                >
                  <span className="font-medium">{item.category}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {SELECT_LABELS.find(([d]) => d === item.decision?.disposition)?.[1] ??
                      "Unresolved / TBD"}{" "}
                    · {issues.length ? `${issues.length} decisions` : "Resolved"}
                  </span>
                </button>
                <div className="flex gap-2">
                  {item.decision?.disposition !== "not-needed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        room &&
                        run([
                          {
                            type: "decision",
                            roomId: room.id,
                            itemId: item.id,
                            disposition: "not-needed",
                          },
                        ])
                      }
                    >
                      Not needed
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpanded(open ? null : item.id)}
                  >
                    {open
                      ? "Close"
                      : item.decision?.disposition === "not-needed"
                        ? "Inspect / restore"
                        : "Review"}
                  </Button>
                </div>
              </div>
              {open && room && (
                <AccuracyItemEditor
                  key={`${item.id}`}
                  state={state}
                  room={room}
                  item={item}
                  source={currentSource}
                  mutate={mutate}
                  busy={busy}
                  materials={materials.filter((m) => m.room_id === room.id)}
                />
              )}
              {item.decision?.disposition === "not-needed" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.decision.actor} · {new Date(item.decision.at).toLocaleString()}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {room && (
        <div className="flex gap-2">
          <Input
            aria-label="Custom requirement name"
            placeholder="Add a custom requirement"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || !newCategory.trim()}
            onClick={() => {
              run([
                {
                  type: "item",
                  roomId: room.id,
                  id: `${room.id}:${crypto.randomUUID()}`,
                  category: newCategory.trim(),
                  kind: "custom",
                  sizeRequired: false,
                },
              ]);
              setNewCategory("");
            }}
          >
            Add requirement
          </Button>
        </div>
      )}
      <details className="border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Governing drawings & checked requirements
        </summary>
        <div className="mt-4 space-y-4 text-sm">
          <p className="text-muted-foreground">
            Identify each governing revision above, including cabinet shop drawings. Each comparison
            applies only to its cited requirement. Overall product size, mounting centers, cutout
            and available opening are different facts.
          </p>
          {!fixture && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void db
                    .listProjectDocuments(projectId)
                    .then((data) =>
                      setDocuments((data ?? []).filter((d) => !d.superseded_by_document_id)),
                    )
                    .catch((e) => setError(e.message));
                }}
              >
                Load project document choices
              </Button>
              {!!documents.length && (
                <select
                  aria-label="Governing document"
                  className="block w-full border border-border p-2"
                  value={selectedDocument}
                  onChange={(e) => {
                    setSelectedDocument(e.target.value);
                    const d = documents.find((d) => d.id === e.target.value);
                    if (d)
                      setSource({
                        id: d.id,
                        kind: "document",
                        documentId: d.id,
                        label: d.title,
                        revision: d.updated_at,
                        reference: "",
                        sheet: "",
                        page: undefined,
                      });
                  }}
                >
                  <option value="">Choose a governing document</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · {d.updated_at}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {state.sources.map((s) => (
            <div key={s.id} className="border border-border p-3">
              <strong>{s.label}</strong> · {s.revision}
              <p>
                {s.reference}
                {s.sheet ? ` · ${s.sheet}, PDF page ${s.page}` : ""}
              </p>
              {s.documentId && !fixture && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {[false, true].map((start) => (
                    <Button
                      key={String(start)}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void request({ action: "extraction", sourceId: s.id, start, retry: true })
                          .then(setExtraction)
                          .catch((e) => setError(e.message));
                      }}
                    >
                      {start ? "Start / retry extraction" : "Check extraction progress"}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void request({
                        action: "extraction",
                        sourceId: s.id,
                        start: false,
                        cancel: true,
                      })
                        .then(setExtraction)
                        .catch((e) => setError(e.message));
                    }}
                  >
                    Cancel extraction
                  </Button>
                </div>
              )}
            </div>
          ))}
          {extraction !== null && (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-bone/30 p-3 text-xs">
              {JSON.stringify(extraction, null, 2)}
            </pre>
          )}
          {!state.checks.length && <p>Not checked. No item-specific comparisons are saved.</p>}
          {state.checks.map((check) => (
            <div key={check.id} className="border border-border p-3">
              <strong>
                {check.field} ·{" "}
                {
                  {
                    matched: "Matches this checked requirement",
                    conflict: "Conflict found",
                    unknown: "Not enough information",
                    stale: "Recheck needed",
                  }[accuracyCheckStatus(state, check)]
                }
              </strong>
              <p>
                {check.mode} · expected {String(check.expected)} {check.unit} · {check.source.label}
                , revision {check.source.revision}, {check.source.sheet} p. {check.source.page}
              </p>
              <p>
                {check.source.reference} · {check.actor} · {new Date(check.at).toLocaleString()}
              </p>
            </div>
          ))}
          {!!progress.incompleteCoverage.length && (
            <p className="text-amber-800">
              Incomplete evidence coverage:{" "}
              {progress.incompleteCoverage
                .map(
                  (c) =>
                    `${c.expected.length - c.processed.length} unprocessed, ${c.failed.length} failed`,
                )
                .join("; ")}
            </p>
          )}
        </div>
      </details>
      <details className="border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Draft outputs & issued history
        </summary>
        <div className="mt-4 space-y-3 text-sm">
          <p>
            These three handoffs use the same selection values and source versions. A changed
            selection flags saved snapshots; uploaded PDFs remain separate issued documents.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["board", "spec", "drawing-handoff"] as const).map((kind) => (
              <Button key={kind} variant="outline" onClick={() => download(kind)}>
                Download {kind} draft data
              </Button>
            ))}
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => run([{ type: "snapshot", id: crypto.randomUUID(), kind: "draft" }])}
            >
              Save draft snapshot
            </Button>
            <Button
              disabled={busy || !projectProgress.designComplete}
              onClick={() =>
                run([{ type: "snapshot", id: crypto.randomUUID(), kind: "design-approved" }])
              }
            >
              Issue design-approved snapshot
            </Button>
          </div>
          {state.snapshots.map((s) => (
            <p key={s.id}>
              {s.kind} · revision {s.revision} · {s.actor} · {new Date(s.at).toLocaleString()} ·{" "}
              <strong>
                {snapshotChanged(state, s)
                  ? "Selections changed — revise affected handoff"
                  : "Current selection values"}
              </strong>
            </p>
          ))}
          {!!progress.allocationIssues.length && (
            <p role="alert" className="text-amber-800">
              {progress.allocationIssues.join(" ")}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

export function AccuracyItemEditor({
  state,
  room,
  item,
  source,
  mutate,
  busy,
  materials,
  onSaved,
  compact = false,
  confirmationReady = true,
  colorOptions = [],
  colorOptionImages = {},
}: {
  state: AccuracyState;
  room: AccuracyRoom;
  item: AccuracyItem;
  source: () => AccuracySource;
  mutate: (commands: AccuracyCommand[], base?: AccuracyState) => Promise<AccuracyState>;
  busy: boolean;
  materials: { id: string; item_label: string }[];
  onSaved?: (state: AccuracyState) => void;
  compact?: boolean;
  confirmationReady?: boolean;
  colorOptions?: string[];
  colorOptionImages?: Record<string, string>;
}) {
  const [edits, setEdits] = useState<Record<string, AccuracyValue>>({});
  const [owner, setOwner] = useState(item.decision?.owner ?? "");
  const [parentId, setParentId] = useState(item.decision?.parentId ?? "");
  const [meravFields, setMeravFields] = useState(item.decision?.meravFields?.join(", ") ?? "");
  const [checkField, setCheckField] = useState("quantity"),
    [expected, setExpected] = useState("");
  const [relation, setRelation] = useState<"equals" | "maximum" | "minimum" | "explicit-presence">(
    "equals",
  );
  const [checkUnit, setCheckUnit] = useState(""),
    [dependency, setDependency] = useState("");
  const [companionName, setCompanionName] = useState("");
  const scope = { roomId: room.id, itemId: item.id };
  const doMutate = (commands: AccuracyCommand[]) => {
    void mutate(commands).catch(() => {});
  };
  const save = async () => {
    const commands = Object.entries(edits).map(([key, value]) => ({
      type: "field" as const,
      ...scope,
      key,
      value,
    }));
    if (!commands.length) return state;
    const next = await mutate(commands);
    setEdits({});
    onSaved?.(next);
    return next;
  };
  const fields = [
    ...new Set([
      ...requiredAccuracyFields(item),
      ...(item.kind === "cabinet-finish" ? ["finishCodeOrSample"] : []),
      ...Object.keys(item.fields),
    ]),
  ];
  const input = (key: string) => (
    <label key={key} className="block min-w-0 text-xs">
      {ACCURACY_FIELD_LABELS[key] ?? key}
      {key === "color" && colorOptions.length > 0 ? (
        <PublishedProductColorInput
          label={ACCURACY_FIELD_LABELS.color}
          value={String(edits.color ?? valueOf(item, "color") ?? "")}
          options={colorOptions}
          disabled={busy}
          onChange={(color) =>
            setEdits({
              ...edits,
              color,
              ...(colorOptionImages[color] ? { imageUrl: colorOptionImages[color] } : {}),
            })
          }
        />
      ) : ["quantityUnit", "purchaseUnit", "coverageUnit"].includes(key) ? (
        <select
          className="mt-1 block w-full border border-border bg-background p-2"
          value={String(edits[key] ?? valueOf(item, key) ?? "")}
          aria-label={ACCURACY_FIELD_LABELS[key] ?? key}
          onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}
        >
          <option value="">Unresolved</option>
          {ACCURACY_UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      ) : (
        <Input
          className="mt-1"
          aria-label={ACCURACY_FIELD_LABELS[key] ?? key}
          type={numericFields.has(key) ? "number" : "text"}
          min={numericFields.has(key) ? 0 : undefined}
          value={edits[key] !== undefined ? (edits[key] ?? "") : (valueOf(item, key) ?? "")}
          onChange={(e) =>
            setEdits({
              ...edits,
              [key]: numericFields.has(key)
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : e.target.value,
            })
          }
        />
      )}
      <span className="mt-1 block text-muted-foreground">
        {fieldConfirmed(state, item, key)
          ? `Confirmed · ${item.fields[key].confirmation!.source.label} · r${item.fields[key].confirmation!.source.revision}`
          : "Unconfirmed / proposed"}
      </span>
      {item.fields[key]?.proposal !== undefined && (
        <span className="mt-1 block text-amber-900">
          New proposal: {String(item.fields[key].proposal)}{" "}
          <button
            className="underline"
            onClick={() => setEdits({ ...edits, [key]: item.fields[key].proposal! })}
          >
            Use proposal in draft
          </button>
        </span>
      )}
    </label>
  );
  return (
    <div className="mt-5 space-y-4">
      <details open={!compact}>
        <summary className="cursor-pointer text-xs">Scope and selection type</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            Scope decision
            <select
              className="mt-1 block w-full border border-border bg-background p-2"
              value={item.decision?.disposition ?? "unresolved"}
              disabled={busy}
              onChange={(e) =>
                doMutate([
                  {
                    type: "decision",
                    ...scope,
                    disposition: e.target.value as Disposition,
                    owner,
                    parentId: parentId || undefined,
                    meravFields: meravFields
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                    source: source(),
                  },
                ])
              }
            >
              {SELECT_LABELS.map(([d, label]) => (
                <option key={d} value={d}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Selection type
            <select
              className="mt-1 block w-full border border-border bg-background p-2"
              value={item.kind}
              disabled={busy}
              onChange={(e) =>
                doMutate([
                  {
                    type: "item",
                    roomId: room.id,
                    id: item.id,
                    category: item.category,
                    kind: e.target.value as AccuracyItem["kind"],
                    sizeRequired: item.sizeRequired,
                  },
                ])
              }
            >
              {[
                ["retail", "Retail product"],
                ["custom", "Custom specification"],
                ["cabinet-finish", "Cabinet finish (Merav scope)"],
                ["coordination", "Specialist coordination"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      {item.kind === "cabinet-finish" && (
        <p className="text-sm text-muted-foreground">
          Confirm the manufacturer, exact approved finish or sample, and application. The cabinet
          person owns box sizes, construction, configuration and shop drawings. Hardware is a
          separate selection.
        </p>
      )}
      {(item.decision?.disposition === "other-party" ||
        item.decision?.disposition === "included" ||
        item.decision?.disposition === "existing") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            Responsible party
            <Input
              placeholder="Cabinet person / builder / client"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Parent item
            <select
              className="mt-1 block w-full border border-border p-2"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Choose parent</option>
              {state.rooms
                .flatMap((r) => r.items)
                .filter((i) => i.id !== item.id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.category} ({i.id})
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs">
            Remaining Merav fields (optional, comma separated)
            <Input
              placeholder="color, location"
              value={meravFields}
              onChange={(e) => setMeravFields(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              doMutate([
                {
                  type: "decision",
                  ...scope,
                  disposition: item.decision!.disposition,
                  owner,
                  parentId: parentId || undefined,
                  meravFields: meravFields
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  source: source(),
                },
              ])
            }
          >
            Save responsibility / assembly evidence
          </Button>
        </div>
      )}
      {item.decision?.disposition === "select" && (
        <label className="block text-xs">
          <input
            type="checkbox"
            checked={item.sizeRequired}
            onChange={(e) =>
              doMutate([
                {
                  type: "item",
                  roomId: room.id,
                  id: item.id,
                  category: item.category,
                  kind: item.kind,
                  sizeRequired: e.target.checked,
                },
              ])
            }
          />{" "}
          Product has applicable size options — confirm exact selected size
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(input)}</div>
      {!!materials.length && (
        <label className="block text-xs">
          Connect this exact selection to an existing Materials / Spec Book row
          <select
            className="mt-1 block w-full border border-border p-2"
            value={item.materialId ?? ""}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value)
                doMutate([{ type: "bind", ...scope, materialId: e.target.value }]);
            }}
          >
            <option value="">Choose the matching row</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.item_label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-muted-foreground">
            Critical facts follow this design decision. Unrelated row notes and ordering history
            stay intact.
          </span>
        </label>
      )}
      {!!state.defaults?.length && (
        <div className="flex flex-wrap gap-2">
          {state.defaults
            .filter((d) => requiredAccuracyFields(item).includes(d.key))
            .map((d) => (
              <Button
                key={d.id}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => doMutate([{ type: "inherit", ...scope, defaultId: d.id }])}
              >
                Use proposed {d.key}: {String(d.value)} · {d.source.label} r{d.source.revision}
              </Button>
            ))}
        </div>
      )}
      {!!fields.length && (
        <div className="flex flex-wrap gap-2">
          {Object.values(item.fields).some((f) => f.proposal !== undefined) && (
            <Button
              variant="outline"
              onClick={() =>
                setEdits({
                  ...edits,
                  ...Object.fromEntries(
                    Object.entries(item.fields)
                      .filter(([, f]) => f.proposal !== undefined)
                      .map(([k, f]) => [k, f.proposal!]),
                  ),
                })
              }
            >
              Use proposed values in draft
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void save().catch(() => {})}>
            Save draft values
          </Button>
          <Button
            disabled={busy || !confirmationReady}
            onClick={() => {
              void save()
                .then((next) => {
                  const updated = next.rooms
                    .find((r) => r.id === room.id)!
                    .items.find((i) => i.id === item.id)!;
                  const keys = Object.entries(updated.fields)
                    .filter(
                      ([key, f]) =>
                        f.value !== null && f.value !== "" && !fieldConfirmed(next, updated, key),
                    )
                    .map(([key]) => key);
                  return mutate([{ type: "confirm", ...scope, keys, source: source() }], next).then(
                    (saved) => {
                      onSaved?.(saved);
                      return saved;
                    },
                  );
                })
                .catch(() => {});
            }}
          >
            Confirm entered values against reference above
          </Button>
        </div>
      )}
      <ul className="list-disc space-y-1 pl-5 text-xs text-amber-900">
        {accuracyItemIssues(state, item).map((issue) => (
          <li key={issue}>
            {issue.replace(
              /^Confirm (\w+) with a current reference\.$/,
              (_, key: string) =>
                `Confirm ${(ACCURACY_FIELD_LABELS[key] ?? key).toLowerCase()} with a current reference.`,
            )}
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm">
          Dimensions, purchase quantities & shared allocations
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "overallDimensions",
            ...(item.kind === "cabinet-finish" ? ["finishType", "finishCodeAvailable"] : []),
            "supplierColor",
            "mountingCenters",
            "cutout",
            "installation",
            "dimensionClarification",
            "width",
            "widthUnit",
            "depth",
            "depthUnit",
            "height",
            "heightUnit",
            "fieldRequired",
            "fieldTakeoff",
            "purchaseUnit",
            "wastePercent",
            "packCoverage",
            "coverageUnit",
            "sellingIncrement",
            "price",
            "priceUnit",
            "installationId",
            "sharedProductId",
            "quantityRole",
            "notes",
          ]
            .filter((k) => !fields.includes(k))
            .map(input)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Waste and pack coverage require confirmation. Ordered and received amounts stay in
          Procurement. A shared total is excluded from summed room allocations. Duplicate views must
          reference the same selection, not new installations.
        </p>
      </details>
      <details>
        <summary className="cursor-pointer text-sm">Companion parts</summary>
        <div className="mt-3 space-y-2">
          {item.companions.map((c) => (
            <div key={c.id} className="flex flex-wrap gap-2 text-xs">
              <span>{c.label}</span>
              <select
                aria-label={`${c.label} responsibility`}
                value={c.disposition ?? ""}
                onChange={(e) =>
                  doMutate([
                    {
                      type: "companion",
                      ...scope,
                      companion: {
                        id: c.id,
                        label: c.label,
                        disposition: e.target.value as "included" | "separate" | "other-party",
                        parentId: parentId || item.id,
                        source: source(),
                      },
                    },
                  ])
                }
              >
                <option value="">Unresolved</option>
                <option value="included">Included with parent</option>
                <option value="separate">Separately selected</option>
                <option value="other-party">By named party in reference</option>
              </select>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              aria-label="Companion component"
              value={companionName}
              placeholder="Required drain / valve / seat from manufacturer evidence"
              onChange={(e) => setCompanionName(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || !companionName}
              onClick={() => {
                doMutate([
                  {
                    type: "companion",
                    ...scope,
                    companion: { id: crypto.randomUUID(), label: companionName },
                  },
                ]);
                setCompanionName("");
              }}
            >
              Add required component
            </Button>
          </div>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm">Compare a specific cited requirement</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            Exact product field
            <Input value={checkField} onChange={(e) => setCheckField(e.target.value)} />
          </label>
          <label className="text-xs">
            Comparison
            <select
              className="mt-1 block w-full border border-border p-2"
              value={relation}
              onChange={(e) => setRelation(e.target.value as typeof relation)}
            >
              <option value="equals">Equals scheduled value</option>
              <option value="maximum">At most stated maximum (same measurement)</option>
              <option value="minimum">At least stated minimum (same measurement)</option>
              <option value="explicit-presence">Explicitly required / shown</option>
            </select>
          </label>
          <label className="text-xs">
            Cited value
            <Input value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
          <label className="text-xs">
            Measurement unit (must match product field unit)
            <Input value={checkUnit} onChange={(e) => setCheckUnit(e.target.value)} />
          </label>
          <label className="text-xs">
            Related item dependency
            <select
              className="mt-1 block w-full border border-border p-2"
              value={dependency}
              onChange={(e) => setDependency(e.target.value)}
            >
              <option value="">Only this field</option>
              {state.rooms
                .flatMap((r) => r.items)
                .filter((i) => i.id !== item.id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.category} ({i.id})
                  </option>
                ))}
            </select>
          </label>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              doMutate([
                {
                  type: "check",
                  check: {
                    id: `${item.id}:${checkField}`,
                    ...scope,
                    field: checkField,
                    expected:
                      relation === "explicit-presence"
                        ? "required"
                        : expected.trim() !== "" && Number.isFinite(Number(expected))
                          ? Number(expected)
                          : expected,
                    relation,
                    unit: checkUnit || undefined,
                    source: source(),
                    mode: "manual",
                  },
                  dependencies: dependency
                    ? ["sku", "color", "overallDimensions", "location"].map((field) => ({
                        itemId: dependency,
                        field,
                      }))
                    : [],
                },
              ])
            }
          >
            Save manual comparison with citation
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Use explicitly supported dimensions of the same kind. Cabinet outside width is not an
          available sink opening. There is no general Fits approval or conflict override.
        </p>
      </details>
      {item.decisionHistory.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs">
            Previous scope decisions ({item.decisionHistory.length})
          </summary>
          {item.decisionHistory.map((d, n) => (
            <p className="mt-2 text-xs" key={n}>
              {d.disposition} · {d.actor} · {d.at}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
