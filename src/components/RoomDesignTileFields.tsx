import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  roomDesignTileFields,
  roomDesignTileIssues,
  roomDesignTileLocation,
  roomDesignTileSurface,
  updateRoomDesignTileNotes,
} from "@/lib/roomDesignTile";

export function RoomDesignTileFields({
  category,
  productName,
  notes,
  onChange,
  disabled = false,
  productSource = "",
}: {
  category: string;
  productName?: string;
  notes?: string;
  onChange: (notes: string) => void;
  disabled?: boolean;
  productSource?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const previousSource = useRef(productSource);
  useEffect(() => {
    if (productSource !== previousSource.current && productSource.trim()) setExpanded(true);
    previousSource.current = productSource;
  }, [productSource]);
  const item = { category, productName, notes };
  const surface = roomDesignTileSurface(item);
  if (surface === "unrelated") return null;
  const fields = roomDesignTileFields(notes);
  const issues = roomDesignTileIssues(item);
  const chooseSurface = roomDesignTileSurface({ ...item, notes: "" }) === "unknown";
  if (surface === "other" && !chooseSurface) return null;
  return (
    <details
      className="group border border-border bg-bone/25"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-xs [&::-webkit-details-marker]:hidden"
        aria-label={`${category} installation details`}
      >
        <span className="min-w-0">
          <span className="font-medium">Tile installation details</span>
          <span className={issues.length ? "ml-2 text-amber-800" : "ml-2 text-muted-foreground"}>
            {issues.length
              ? `${issues.length} ${issues.length === 1 ? "decision" : "decisions"} needed`
              : surface === "other"
                ? "Not tile"
                : "Complete"}
          </span>
          <span className="mt-1 block truncate text-muted-foreground">
            {[fields.groutColor, fields.jointWidth, fields.layout, fields.direction]
              .filter(Boolean)
              .join(" · ") ||
              (surface === "unknown"
                ? "Choose tile or another material"
                : surface === "other"
                  ? "Grout and tile layout are not required"
                  : "Add grout, pattern and lay direction")}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        {chooseSurface && (
          <label className="block text-xs">
            Surface material
            <select
              aria-label={`${category} surface material`}
              disabled={disabled}
              value={surface === "tile" ? "Tile" : surface === "other" ? "Other material" : ""}
              onChange={(e) =>
                onChange(updateRoomDesignTileNotes(notes, "surface", e.target.value))
              }
              className="mt-1 block h-9 w-full border border-border bg-background px-2"
            >
              <option value="">Choose material type</option>
              <option value="Tile">Tile</option>
              <option value="Other material">Other material (wood, slab, paint, etc.)</option>
            </select>
          </label>
        )}
        {surface === "tile" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["location", "Where used", "e.g. Shower walls, including niche"],
                  ["groutColor", "Grout brand / color", "e.g. MAPEI Avalanche"],
                  ["jointWidth", "Grout joint width", "e.g. 3/16 inch"],
                  ["layout", "Tile layout / pattern", "e.g. Stacked or 1/3 running bond"],
                  ["direction", "Tile lay direction", "e.g. Vertical or parallel to hallway"],
                ] as const
              ).map(([field, label, placeholder]) => (
                <label key={field} className="block text-xs">
                  {label}
                  <Input
                    aria-label={`${category} ${label}`}
                    value={fields[field]}
                    disabled={disabled}
                    maxLength={500}
                    placeholder={
                      field === "location" && roomDesignTileLocation(item)
                        ? `${roomDesignTileLocation(item)} (from item type)`
                        : placeholder
                    }
                    onChange={(e) =>
                      onChange(updateRoomDesignTileNotes(notes, field, e.target.value))
                    }
                    className="mt-1"
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(updateRoomDesignTileNotes(notes, field, "TBD"))}
                    className="mt-1 text-[10px] underline underline-offset-2 disabled:opacity-50"
                    aria-label={`${category} mark ${label} TBD`}
                  >
                    Decide later · TBD
                  </button>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              You can keep gathering products with TBD decisions. They stay flagged until confirmed.
              An approved drawing or marked reference can define the layout and direction.
            </p>
            {notes && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">View saved notes</summary>
                <p className="mt-2 whitespace-pre-line">{notes}</p>
              </details>
            )}
          </>
        )}
        {issues.length > 0 && (
          <p className="text-xs text-amber-800" role="status">
            {issues.join(" ")}
          </p>
        )}
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => setExpanded(false)}
          aria-label={`Collapse ${category} installation details`}
        >
          Collapse details
        </button>
      </div>
    </details>
  );
}
