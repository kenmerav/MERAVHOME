import { useState } from "react";
import { Input } from "./ui/input";

export function PublishedProductColorInput({
  value,
  options = [],
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  options?: string[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  if (!options.length || custom)
    return (
      <div>
        <Input
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {options.length > 0 && (
          <button type="button" className="mt-1 text-xs underline" onClick={() => setCustom(false)}>
            Show published colors
          </button>
        )}
      </div>
    );
  return (
    <select
      className="block w-full border border-border bg-background p-2"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => (e.target.value === "__custom" ? setCustom(true) : onChange(e.target.value))}
    >
      <option value="">Choose a published color</option>
      {value && !options.includes(value) && <option value={value}>{value} (current)</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
      <option value="__custom">Another approved color / finish</option>
    </select>
  );
}
