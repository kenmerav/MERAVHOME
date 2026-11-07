import { describe, expect, it } from "vitest";
import { boardSendError, createBoardSendGate } from "../src/lib/boardSendGuard";

describe("board send protection", () => {
  it("prevents overlapping single, page, and board sends and allows a later retry", () => {
    const gate = createBoardSendGate();
    const finish = gate.tryBegin();
    expect(finish).not.toBeNull();
    expect(gate.tryBegin()).toBeNull();
    finish?.();
    const next = gate.tryBegin();
    expect(next).not.toBeNull();
    finish?.(); // A late duplicate release must not unlock the new send.
    expect(gate.tryBegin()).toBeNull();
    next?.();
    expect(gate.tryBegin()).not.toBeNull();
  });

  it("explains a concurrent board-item conflict without swallowing other errors", () => {
    expect(
      boardSendError(
        { code: "23505", message: "material_items_board_source_unique: board item already exists" },
        "fallback",
      ),
    ).toMatch(/already sent.*refresh/i);
    expect(boardSendError({ code: "23505", message: "some other constraint" }, "fallback")).toBe(
      "some other constraint",
    );
    expect(boardSendError(new Error("Network unavailable"), "fallback")).toBe(
      "Network unavailable",
    );
    expect(boardSendError(null, "fallback")).toBe("fallback");
  });
});
