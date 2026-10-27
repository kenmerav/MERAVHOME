import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BoardQuantityReviewDialog } from "../../../src/components/BoardQuantityReviewDialog";
import {
  boardQuantityDescription,
  boardQuantityConflict,
  type BoardQuantityConflict,
  type BoardQuantityDecisions,
} from "../../../src/lib/boardQuantityReview";
import {
  specQuantityDatabasePatch,
  type SpecQuantity,
  type SpecQuantityPatch,
} from "../../../src/lib/specQuantity";
import type { MaterialItem } from "../../../src/lib/db";
import "../../../src/styles.css";
import { SpecQuantityEditor } from "../../../src/components/SpecQuantityEditor";
import { newMaterialQuantityDefaults } from "../../../src/lib/materialQuantityDefaults";

const initial = [
  {
    id: "pendant",
    project_id: "test",
    room_id: "kitchen",
    item_label: "Island pendants",
    quantity: 4,
    quantity_tbd: false,
    quantity_unit: "count",
    waste_percent: 0,
  },
  {
    id: "tile",
    project_id: "test",
    room_id: "kitchen",
    item_label: "Backsplash tile",
    quantity: 100,
    quantity_tbd: false,
    quantity_unit: "square_feet",
    waste_percent: 15,
  },
  {
    id: "unnamed",
    project_id: "test",
    room_id: "kitchen",
    item_label: "Unlabeled Item",
    quantity: 2,
    quantity_tbd: false,
    quantity_unit: "count",
    waste_percent: 0,
    image_url:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Cpath d='M25 53h50l-11-28H36zM50 53v22M36 76h28' fill='none' stroke='%236b6157' stroke-width='4'/%3E%3C/svg%3E",
    product: { name: "Example table lamp" },
  },
] as MaterialItem[];
const board = {
  quantity: 1,
  quantity_tbd: false,
  quantity_unit: "count",
  waste_percent: 0,
} as SpecQuantityPatch;
function TestPage() {
  const [items, setItems] = useState(initial);
  const [newItems, setNewItems] = useState<Array<SpecQuantity & { category: string }>>(() =>
    ["Tile & Stone", "Doors Base & Case", "Cabinetry"].map((category) => ({
      category,
      quantity: null,
      ...newMaterialQuantityDefaults(category, null),
    })),
  );
  const [conflicts, setConflicts] = useState<BoardQuantityConflict[] | null>(null);
  const [message, setMessage] = useState("");
  const resolve = (decisions: BoardQuantityDecisions | null) => {
    if (!decisions) setMessage("Send canceled. Spec Book quantities unchanged.");
    else {
      setItems((current) =>
        current.map((item) => {
          const conflict = conflicts?.find((c) => c.materialId === item.id);
          const decision = conflict && decisions[conflict.key];
          if (conflict && decision === "board")
            return { ...item, ...specQuantityDatabasePatch(conflict.board) };
          if (decision && typeof decision === "object" && decision.kind === "custom")
            return { ...item, ...specQuantityDatabasePatch(decision.quantity) };
          return item;
        }),
      );
      setMessage("Local send complete. Unselected quantities preserved.");
    }
    setConflicts(null);
  };
  return (
    <main className="min-h-screen bg-bone p-10 text-ink">
      <div className="eyebrow">MERAV Studio · Local test</div>
      <h1 className="mt-4 font-display text-4xl">Spec Book quantity safeguard</h1>
      <p className="my-4 text-sm text-muted-foreground">
        Sample items. This page does not connect to a live project.
      </p>
      <h2 className="mt-6 font-display text-2xl">New item defaults</h2>
      <table className="my-4 w-full max-w-3xl border border-border bg-white text-sm">
        <thead>
          <tr>
            <th className="p-4 text-left">Category</th>
            <th className="p-4 text-left">Starting quantity</th>
          </tr>
        </thead>
        <tbody>
          {newItems.map((item) => (
            <tr key={item.category} className="border-t border-border">
              <td className="p-4">{item.category}</td>
              <td className="p-4">
                <SpecQuantityEditor
                  item={item}
                  label={item.category}
                  onSave={async (patch) => {
                    setNewItems((current) =>
                      current.map((row) =>
                        row.category === item.category ? { ...row, ...patch } : row,
                      ),
                    );
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mt-6 font-display text-2xl">Existing quantities</h2>
      <table className="my-6 w-full max-w-3xl border border-border bg-white text-sm">
        <thead>
          <tr>
            <th className="p-4 text-left">Kitchen item</th>
            <th className="p-4 text-left">Saved Spec Book quantity</th>
            <th className="p-4 text-left">Board quantity</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-border">
              <td className="p-4">{item.item_label}</td>
              <td className="p-4">{boardQuantityDescription(item)}</td>
              <td className="p-4">1 Count</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="bg-ink px-5 py-3 text-sm text-white"
        onClick={() => {
          const next = items
            .map((item) =>
              boardQuantityConflict(item, board, "Kitchen", {
                boardPageId: "sample-page",
                boardElementId: item.id,
              }),
            )
            .filter((value): value is BoardQuantityConflict => value !== null);
          if (next.length) setConflicts(next);
          else setMessage("Quantities match. Local send complete.");
        }}
      >
        Send full design board to Materials
      </button>
      <button
        className="ml-4 border border-border bg-white px-5 py-3 text-sm"
        onClick={() => {
          setItems(structuredClone(initial));
          setMessage("");
        }}
      >
        Reset sample
      </button>
      <p role="status" className="mt-5 text-sm">
        {message}
      </p>
      {conflicts && (
        <BoardQuantityReviewDialog
          conflicts={conflicts}
          onResolve={resolve}
          projectId="local-test"
          onViewBoard={(item) => setMessage(`Local preview: show ${item.itemLabel} on its board.`)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<TestPage />);
