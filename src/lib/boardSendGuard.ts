/** A synchronous gate for single-item, page and full-board sends in one tab. */
export function createBoardSendGate() {
  let active = false;
  return {
    tryBegin(): (() => void) | null {
      if (active) return null;
      active = true;
      let released = false;
      return () => {
        if (!released) active = false;
        released = true;
      };
    },
  };
}

export function boardSendError(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const result = error as { code?: string; message?: string; details?: string };
    if (
      result.code === "23505" &&
      `${result.message || ""} ${result.details || ""}`.includes(
        "material_items_board_source_unique",
      )
    ) {
      return "This board item was already sent. Refresh the page and send again to review the saved selection.";
    }
    if (result.message) return result.message;
  }
  return fallback;
}
