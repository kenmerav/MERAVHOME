import { useState } from "react";

export function MeasuredLayoutEstimateApproval({
  disabled,
  onAccept,
}: {
  disabled: boolean;
  onAccept: (source: string) => void;
}) {
  const [source, setSource] = useState("");
  const [accepted, setAccepted] = useState(false);
  return (
    <details className="mt-4 border-t border-amber-300 pt-3">
      <summary className="cursor-pointer">
        Use drawing-derived measurements for a rendering draft
      </summary>
      <p className="mt-3">
        Enter the scaled measurements in Correct source measurements below, then record their source
        and assumptions here.
      </p>
      <label className="block mt-3">
        Measurement source and assumptions
        <textarea
          aria-label="Scaled layout source and assumptions"
          className="block w-full border bg-white p-3 mt-1 min-h-24"
          value={source}
          maxLength={2000}
          disabled={disabled}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Sheet, scale, accepted measurements and any remaining placement assumptions"
        />
      </label>
      <label className="flex items-start gap-2 mt-3">
        <input
          type="checkbox"
          checked={accepted}
          disabled={disabled}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>
          I accept the entered layout for this rendering draft. Scaled and illustrative measurements
          are not confirmed construction dimensions.
        </span>
      </label>
      <button
        type="button"
        className="border border-ink bg-white px-4 py-2 mt-3 disabled:opacity-40"
        disabled={disabled || !accepted || source.trim().length < 10}
        onClick={() => onAccept(source.trim())}
      >
        Use entered layout as a scaled-plan draft
      </button>
    </details>
  );
}
