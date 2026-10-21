import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function RoomDesignDisclosure({
  title,
  label,
  status,
  description,
  attention = false,
  expanded,
  onExpandedChange,
  children,
}: {
  title: string;
  label: string;
  status?: string;
  description?: string;
  attention?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
      className={cn(
        "overflow-hidden border bg-background",
        attention ? "border-amber-300" : "border-border",
      )}
    >
      <summary
        aria-label={label}
        className="flex cursor-pointer list-none items-center gap-3 bg-bone/40 px-4 py-4 hover:bg-bone/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("h-5 w-5 shrink-0 transition-transform", expanded && "rotate-180")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">{title}</span>
            {status && (
              <span
                className={cn("text-xs", attention ? "text-amber-800" : "text-muted-foreground")}
              >
                {status}
              </span>
            )}
          </span>
          {!expanded && description && (
            <span className="mt-1 block truncate text-xs text-muted-foreground">{description}</span>
          )}
        </span>
        <span className="shrink-0 border border-border bg-background px-3 py-1.5 text-xs font-medium">
          {expanded ? "Collapse" : "Expand"}
        </span>
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
