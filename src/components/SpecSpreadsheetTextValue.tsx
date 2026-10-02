import { createContext, useContext } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// A display preference only: changing row height must never save product data.
export const SpecSpreadsheetWrapContext = createContext(true);

export function SpecSpreadsheetTextValue({
  value,
  canEdit = false,
  onEdit,
  className = "",
  wide = false,
  alwaysWrap = false,
  narrow = false,
}: {
  value: string;
  canEdit?: boolean;
  onEdit?: () => void;
  className?: string;
  wide?: boolean;
  alwaysWrap?: boolean;
  narrow?: boolean;
}) {
  const preferredWrap = useContext(SpecSpreadsheetWrapContext);
  // Product identities and notes stay readable even when other columns use compact rows.
  const wrapText = alwaysWrap || preferredWrap;
  const widthClassName = wide && wrapText
    ? "w-[480px] min-w-[480px] max-w-[480px] print:min-w-0"
    : alwaysWrap && narrow
      ? "w-[180px] min-w-[180px] max-w-[180px] print:min-w-0"
      : alwaysWrap
        ? "w-[240px] min-w-[240px] max-w-[240px] print:min-w-0"
        : "max-w-[240px]";
  const textClassName = `block ${widthClassName} text-left underline-offset-4 ${
    wrapText ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "truncate"
  } print:w-auto print:max-w-none print:whitespace-pre-wrap print:overflow-visible print:text-clip print:[overflow-wrap:anywhere] ${className}`;
  const display = canEdit ? (
    <button
      type="button"
      onClick={onEdit}
      className={`${textClassName} hover:text-ink hover:underline`}
      title={value || "Click to edit"}
      aria-label={value ? `Edit ${value}` : "Edit empty cell"}
    >
      {value || "—"}
    </button>
  ) : (
    <span className={textClassName} title={value || undefined} tabIndex={value ? 0 : undefined}>
      {value || "—"}
    </span>
  );

  if (!value) return display;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{display}</TooltipTrigger>
        <TooltipContent className="max-h-[60vh] max-w-[min(40rem,calc(100vw-2rem))] overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] print:hidden">
          {value}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
