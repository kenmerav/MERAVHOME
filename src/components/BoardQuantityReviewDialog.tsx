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
export function BoardQuantityReviewDialog({
  conflicts,
  onResolve,
}: {
  conflicts: BoardQuantityConflict[];
  onResolve: (decisions: BoardQuantityDecisions | null) => void;
}) {
  const [replacements, setReplacements] = useState<Set<string>>(new Set());
  const resolve = (replace: boolean) =>
    onResolve(
      Object.fromEntries(
        conflicts.map((item) => [
          item.key,
          replace && replacements.has(item.key) ? "board" : "keep",
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">
            Keep your Spec Book quantities?
          </DialogTitle>
          <DialogDescription>
            These items have different quantities on the design board. Your saved Spec Book
            quantities will stay unless you choose a replacement below.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto border border-border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-bone">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3">Spec Book</th>
                <th className="p-3">Design board</th>
                <th className="p-3">Replace</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((item) => (
                <tr key={item.key} className="border-t border-border align-top">
                  <td className="p-3">
                    <div>{item.itemLabel}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.roomName}</div>
                  </td>
                  <td className="p-3 font-medium">{boardQuantityDescription(item.spec)}</td>
                  <td className="p-3">{boardQuantityDescription(item.board)}</td>
                  <td className="p-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        aria-label={`Use board quantity for ${item.itemLabel} in ${item.roomName}`}
                        checked={replacements.has(item.key)}
                        onChange={(event) =>
                          setReplacements((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.key);
                            else next.delete(item.key);
                            return next;
                          })
                        }
                      />
                      Use board quantity
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => onResolve(null)}>
            Cancel send
          </Button>
          <Button variant="outline" disabled={!replacements.size} onClick={() => resolve(true)}>
            Replace selected ({replacements.size}) &amp; send
          </Button>
          <Button onClick={() => resolve(false)}>Keep Spec Book quantities &amp; send</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
