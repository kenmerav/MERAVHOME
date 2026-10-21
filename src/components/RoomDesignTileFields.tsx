import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState } from "react";
import { RoomDesignDisclosure } from "@/components/RoomDesignDisclosure";
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
  // Generic wall/floor rows should wait for the gathered product before asking
  // whether it needs tile installation details. Explicit tile rows still open immediately.
  if (surface === "unknown" && !productName?.trim()) return null;
  const fields = roomDesignTileFields(notes);
  const isProjectDefault = /tile installation defaults/i.test(category);
  const issues = roomDesignTileIssues(item);
  const chooseSurface = roomDesignTileSurface({ ...item, notes: "" }) === "unknown";
  if (surface === "other" && !chooseSurface) return null;
  return (
    <RoomDesignDisclosure
      expanded={expanded}
      onExpandedChange={setExpanded}
      label={`${category} installation details`}
      title={surface === "tile" ? "Tile installation" : "Material type"}
      attention={issues.length > 0}
      status={
        issues.length
          ? `${issues.length} ${issues.length === 1 ? "decision" : "decisions"} needed`
          : isProjectDefault
            ? "Shared defaults"
            : surface === "other"
              ? "Not tile"
              : "Complete"
      }
      description={
        [
          fields.groutColor,
          fields.jointWidth,
          fields.layout,
          fields.direction,
          fields.edgeTreatment,
        ]
          .filter(Boolean)
          .join(" · ") ||
        (surface === "unknown"
          ? "Choose tile or another material"
          : surface === "other"
            ? "Grout and tile layout are not required"
            : "Add grout, pattern and lay direction")
      }
    >
      <div className="space-y-3">
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
              )
                .filter(([field]) => !isProjectDefault || field !== "location")
                .map(([field, label, placeholder]) => (
                  <label key={field} className="block text-xs">
                    {label}
                    <Input
                      aria-label={`${category} ${label}`}
                      value={field === "location" ? roomDesignTileLocation(item) : fields[field]}
                      disabled={disabled}
                      maxLength={500}
                      placeholder={placeholder}
                      onChange={(e) =>
                        onChange(updateRoomDesignTileNotes(notes, field, e.target.value))
                      }
                      className="mt-1"
                    />
                    {field === "location" && !fields.location && roomDesignTileLocation(item) ? (
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        From item type
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(updateRoomDesignTileNotes(notes, field, "TBD"))}
                        className="mt-1 text-[10px] underline underline-offset-2 disabled:opacity-50"
                        aria-label={`${category} mark ${label} TBD`}
                      >
                        Decide later · TBD
                      </button>
                    )}
                  </label>
                ))}
            </div>
            <label className="block text-xs">
              Exposed tile edges
              <select
                aria-label={`${category} tile edge treatment`}
                disabled={disabled}
                value={fields.edgeTreatment}
                onChange={(event) =>
                  onChange(updateRoomDesignTileNotes(notes, "edgeTreatment", event.target.value))
                }
                className="mt-1 block h-9 w-full border border-border bg-background px-2"
              >
                <option value="">Choose if applicable</option>
                {[
                  "No exposed edges",
                  "Metal trim",
                  "Pencil / bullnose",
                  "Mitered edges",
                  "Factory-finished edge",
                  "TBD",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            {["Metal trim", "Pencil / bullnose"].includes(fields.edgeTreatment) && (
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["edgeProduct", "Edge product / profile", "Exact trim product or profile"],
                    ["edgeFinish", "Edge finish / color", "Exact selected trim finish"],
                    ["edgeSize", "Edge size", "Match tile thickness / profile"],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <label key={field} className="block text-xs">
                    {label}
                    <Input
                      aria-label={`${category} ${label}`}
                      disabled={disabled}
                      value={fields[field]}
                      placeholder={placeholder}
                      onChange={(event) =>
                        onChange(updateRoomDesignTileNotes(notes, field, event.target.value))
                      }
                      className="mt-1"
                    />
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {isProjectDefault
                ? "Set only the choices shared across the project. Each room can keep its own exceptions."
                : "You can keep gathering products with TBD decisions. They stay flagged until confirmed. An approved drawing or marked reference can define the layout and direction."}
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
      </div>
    </RoomDesignDisclosure>
  );
}
