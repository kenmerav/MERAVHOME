import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { parseRoomDesignQuantity, roomDesignQuantityLabel } from "@/lib/roomDesignQuantity";

export function RoomDesignQuantityInput({
  value,
  onValueChange,
  ...props
}: {
  value: number | null | undefined;
  onValueChange: (value: number | null) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}) {
  const label = roomDesignQuantityLabel(value);
  const [draft, setDraft] = useState(label);
  useEffect(() => setDraft(label), [label]);
  function commit(input: HTMLInputElement) {
    try {
      const next = parseRoomDesignQuantity(draft);
      input.setCustomValidity("");
      setDraft(roomDesignQuantityLabel(next));
      onValueChange(next);
    } catch {
      input.setCustomValidity("Enter a positive quantity or TBD.");
      input.reportValidity();
    }
  }
  return (
    <Input
      {...props}
      type="text"
      placeholder="Number or TBD"
      value={draft}
      onChange={(event) => {
        event.currentTarget.setCustomValidity("");
        setDraft(event.target.value);
      }}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget);
        }
      }}
    />
  );
}
