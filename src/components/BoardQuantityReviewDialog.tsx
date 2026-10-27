import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  boardQuantityDescription,
  type BoardQuantityConflict,
  type BoardQuantityDecisions,
} from "@/lib/boardQuantityReview";
import { parseSpecQuantity, specQuantityUnitLabel } from "@/lib/specQuantity";
import { completionMaterialsLink, completionProductLink } from "@/lib/specCompletionPresentation";

export function BoardQuantityReviewDialog({
  conflicts,
  onResolve,
  projectId,
  onViewBoard,
}: {
  conflicts: BoardQuantityConflict[];
  onResolve: (decisions: BoardQuantityDecisions | null) => void;
  projectId?: string;
  onViewBoard?: (item: BoardQuantityConflict) => void;
}) {
  const [choices, setChoices] = useState<Record<string, "spec" | "board">>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const parsed = conflicts.map((item) => {
    const draft = drafts[item.key]?.trim() || "";
    if (!draft || choices[item.key] === "board") return { item, draft, quantity: null, error: "" };
    try {
      return {
        item,
        draft,
        quantity: parseSpecQuantity(draft, item.spec.quantity_unit, item.spec.waste_percent),
        error: "",
      };
    } catch (error) {
      return {
        item,
        draft,
        quantity: null,
        error: error instanceof Error ? error.message : "Enter a valid quantity.",
      };
    }
  });
  const hasErrors = parsed.some((row) => !!row.error);
  const resolve = () =>
    onResolve(
      Object.fromEntries(
        parsed.map(({ item, quantity }) => [
          item.key,
          choices[item.key] === "board"
            ? "board"
            : quantity
              ? { kind: "custom" as const, quantity }
              : "keep",
        ]),
      ),
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onResolve(null);
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">
            Review Spec Book quantities
          </DialogTitle>
          <DialogDescription>
            Choose the Spec Book or board quantity for each item, or enter a new Spec Book quantity.
            Changes are applied when you send. The quantities on the board stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="sticky top-0 bg-bone">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3">Spec Book</th>
                <th className="p-3">Design board</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map(({ item, draft, error }, index) => {
                const materialLink =
                  projectId && item.roomId
                    ? completionMaterialsLink(projectId, item.roomId, item.materialId)
                    : null;
                const productLink = completionProductLink(item.productUrl);
                const descriptiveProduct =
                  item.productName &&
                  !/^(?:unlabeled|unnamed|untitled)(?: item| product)?$/i.test(
                    item.productName.trim(),
                  ) &&
                  item.productName.trim() !== item.itemLabel.trim();
                return (
                  <tr key={item.key} className="border-t border-border align-top">
                    <td className="p-3">
                      <div className="flex gap-3">
                        {item.imageUrl &&
                          (materialLink ? (
                            <a
                              href={materialLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`View ${item.itemLabel} in Materials`}
                            >
                              <img
                                src={item.imageUrl}
                                alt=""
                                className="h-16 w-16 border object-contain"
                                loading="lazy"
                              />
                            </a>
                          ) : (
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="h-16 w-16 border object-contain"
                              loading="lazy"
                            />
                          ))}
                        <div>
                          {materialLink ? (
                            <a
                              href={materialLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium underline underline-offset-2"
                            >
                              {item.itemLabel || "Unlabeled item"}
                            </a>
                          ) : (
                            <span className="font-medium">
                              {item.itemLabel || "Unlabeled item"}
                            </span>
                          )}
                          <div className="mt-1 text-xs text-muted-foreground">{item.roomName}</div>
                          {descriptiveProduct && (
                            <div className="mt-1 text-xs">{item.productName}</div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {materialLink && (
                              <a
                                href={materialLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                View in Materials
                              </a>
                            )}
                            {productLink && (
                              <a
                                href={productLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                Product link
                              </a>
                            )}
                            {onViewBoard && item.boardPageId && item.boardElementId && (
                              <button
                                type="button"
                                className="underline"
                                onClick={() => {
                                  onResolve(null);
                                  onViewBoard(item);
                                }}
                              >
                                Show on board · cancel send
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <label className="flex items-center gap-2 font-medium whitespace-nowrap">
                        <input
                          type="radio"
                          name={`quantity-choice-${index}`}
                          aria-label={`Use Spec Book quantity for ${item.itemLabel} in ${item.roomName}`}
                          checked={choices[item.key] !== "board"}
                          onChange={() =>
                            setChoices((current) => ({ ...current, [item.key]: "spec" }))
                          }
                        />
                        {boardQuantityDescription(item.spec)}
                      </label>
                      <label className="mt-3 block text-xs">
                        Change quantity ({specQuantityUnitLabel(item.spec.quantity_unit)})
                        <input
                          aria-label={`New quantity for ${item.itemLabel} in ${item.roomName}`}
                          value={draft}
                          placeholder="Number or TBD"
                          className="mt-1 h-9 w-36 border border-input bg-background px-2 text-sm"
                          onChange={(event) => {
                            setDrafts((current) => ({
                              ...current,
                              [item.key]: event.target.value,
                            }));
                            if (event.target.value.trim())
                              setChoices((current) => ({ ...current, [item.key]: "spec" }));
                          }}
                        />
                      </label>
                      {error && (
                        <p role="alert" className="mt-1 max-w-48 text-xs text-red-700">
                          {error}
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      <label className="flex items-center gap-2 whitespace-nowrap">
                        <input
                          type="radio"
                          name={`quantity-choice-${index}`}
                          aria-label={`Use board quantity for ${item.itemLabel} in ${item.roomName}`}
                          checked={choices[item.key] === "board"}
                          onChange={() => {
                            setChoices((current) => ({ ...current, [item.key]: "board" }));
                            setDrafts((current) => ({ ...current, [item.key]: "" }));
                          }}
                        />
                        {boardQuantityDescription(item.board)}
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => onResolve(null)}>
            Cancel send
          </Button>
          <Button disabled={hasErrors} onClick={resolve}>
            Send to Materials
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
