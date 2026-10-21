import { useEffect, useRef, useState } from "react";
import { RoomDesignDisclosure } from "@/components/RoomDesignDisclosure";
import { Input } from "@/components/ui/input";
import {
  roomDetailValue,
  roomItemDetailFields,
  roomItemStatus,
  roomDecisionIssues,
  updateRoomDetail,
  type RoomItemStatus,
} from "@/lib/roomDesignDetails";

export function RoomDesignItemDetails({
  category,
  notes,
  productSource = "",
  itemStatus,
  productName,
  defaultNotes,
  defaultCount = 0,
  disabled = false,
  onChange,
}: {
  category: string;
  notes?: string;
  productSource?: string;
  itemStatus?: RoomItemStatus;
  productName?: string;
  defaultNotes?: string;
  defaultCount?: number;
  disabled?: boolean;
  onChange: (notes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const prior = useRef(productSource);
  useEffect(() => {
    if (productSource && productSource !== prior.current) setExpanded(true);
    prior.current = productSource;
  }, [productSource]);
  const fields = roomItemDetailFields(category, { notes, productName });
  if (!fields.length && !roomDetailValue(notes, "Related change review")) return null;
  const status = itemStatus ?? roomItemStatus({ category, notes, url: productSource });
  const saved = fields.map((field) => roomDetailValue(notes, field.label)).filter(Boolean);
  const pending =
    saved.some((value) => /\bTBD\b|to be (?:decided|confirmed)/i.test(value)) ||
    roomDecisionIssues({ category, notes }).length > 0;
  const sections = [...new Set(fields.map((field) => field.section).filter(Boolean))];
  const renderField = (field: (typeof fields)[number]) => (
    <label className="block text-xs" key={field.label}>
      {field.label}
      {field.options ? (
        <select
          aria-label={`${category} ${field.label}`}
          value={roomDetailValue(notes, field.label)}
          disabled={disabled}
          onChange={(event) => onChange(updateRoomDetail(notes, field.label, event.target.value))}
          className="mt-1 block h-9 w-full border border-border bg-background px-2"
        >
          <option value="">Choose if applicable</option>
          {field.options.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      ) : (
        <>
          <Input
            aria-label={`${category} ${field.label}`}
            disabled={disabled}
            maxLength={1000}
            value={roomDetailValue(notes, field.label)}
            placeholder={field.placeholder}
            className="mt-1"
            onChange={(event) => onChange(updateRoomDetail(notes, field.label, event.target.value))}
          />
        </>
      )}
    </label>
  );
  return (
    <div className="space-y-3">
      {roomDetailValue(notes, "Related change review") && (
        <div
          role="status"
          className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <p className="font-medium">Confirm fit after a related change</p>
          <p className="mt-1">{roomDetailValue(notes, "Related change review")}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(updateRoomDetail(notes, "Related change review", ""))}
            className="mt-3 border border-amber-300 bg-background px-3 py-2 font-medium"
          >
            Confirm related fit checked
          </button>
        </div>
      )}
      {fields.length > 0 && (
        <RoomDesignDisclosure
          expanded={expanded}
          onExpandedChange={setExpanded}
          label={`${category} item details`}
          title={
            fields.filter((field) => !field.section).length === 1
              ? "Notes"
              : /paint|wall finish|ceiling finish/i.test(category) &&
                  !/tile/i.test(productName || "")
                ? "Paint details"
                : "Installation details"
          }
          attention={pending}
          status={
            pending
              ? "Decisions needed"
              : saved.length
                ? `${saved.length} details added`
                : "Optional"
          }
          description={
            saved.join(" · ") ||
            fields
              .slice(0, 3)
              .map((field) => field.label)
              .join(" · ")
          }
        >
          <div className="space-y-3">
            {status !== "Not needed" && (
              <>
                {defaultCount > 0 && defaultNotes && (
                  <button
                    type="button"
                    disabled={disabled}
                    className="border border-border bg-background px-3 py-2 text-xs"
                    onClick={() => onChange(defaultNotes)}
                  >
                    Use project-wide details ({defaultCount} blank fields)
                  </button>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {fields.filter((field) => !field.section).map(renderField)}
                </div>
                {sections.map((section) => (
                  <details key={section} className="border border-border bg-background/60 text-xs">
                    <summary
                      className="cursor-pointer p-3 font-medium"
                      aria-label={`${category} ${section}`}
                    >
                      {section}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {
                          fields.filter(
                            (field) =>
                              field.section === section && roomDetailValue(notes, field.label),
                          ).length
                        }{" "}
                        details added
                      </span>
                    </summary>
                    <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                      {fields.filter((field) => field.section === section).map(renderField)}
                    </div>
                  </details>
                ))}
                <p className="text-xs text-muted-foreground">
                  Product information fills from the link when you gather products. Add only
                  installation choices or exceptions here.
                </p>
              </>
            )}
          </div>
        </RoomDesignDisclosure>
      )}
    </div>
  );
}
