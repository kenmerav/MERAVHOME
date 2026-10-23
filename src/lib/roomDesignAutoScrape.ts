import type { RoomDesignLink, RoomDesignSelection } from "./roomDesignWorkflow";
import { retainRoomDesignMeasurements, ROOM_DESIGN_REVIEW_FIELDS } from "./roomDesignReview";
import { roomDesignScrapedNotes, synchronizeRoomSelectionDetails } from "./roomDesignDetails";

export function roomDesignLinkSourceKey(link: Pick<RoomDesignLink, "id" | "url" | "productId">) {
  return JSON.stringify([link.id, link.url.trim(), link.productId || ""]);
}

/** A delayed lookup must not overwrite decisions entered while it was running. */
export function mergeAutomaticRoomProduct<T extends RoomDesignSelection>(
  scraped: T,
  before: T | undefined,
  current: T | undefined,
  link: Pick<RoomDesignLink, "url" | "quantity" | "notes">,
): T | null {
  if ((scraped.url || "").trim() !== link.url.trim()) return null;
  if (current?.accuracySource) {
    // Canonical project choices can change only through explicit draft acceptance.
    return { ...current, reviewFields: [...new Set([...(current.reviewFields ?? []), "finish", "sku", "dimensions"])], scrapeStatus: "partial", scrapeError: "New product facts are proposals. Review them in Design decisions before changing confirmed values." };
  }
  const next = retainRoomDesignMeasurements(
    {
      ...scraped,
      quantity: link.quantity,
      notes: link.notes,
      materialsSyncStatus: current?.materialsSyncStatus ?? scraped.materialsSyncStatus,
    },
    current,
  );
  const changed =
    before && current
      ? Object.keys(ROOM_DESIGN_REVIEW_FIELDS).filter(
          (key) => current[key as keyof T] !== before[key as keyof T],
        )
      : [];
  for (const key of changed) (next as Record<string, unknown>)[key] = current![key as keyof T];
  Object.assign(
    next,
    synchronizeRoomSelectionDetails<RoomDesignSelection>(before ?? scraped, { notes: link.notes }),
  );
  next.notes = roomDesignScrapedNotes(next.notes, next.category, next.productName, next.finish);
  if (changed.length) {
    next.reviewFields = [...new Set([...(current?.reviewFields ?? []), ...changed])];
    next.scrapeStatus = "partial";
    next.scrapeError = "Review the edited product details.";
  }
  return next;
}
