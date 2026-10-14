import { expect, it } from "vitest";
import { extensionImportDestination } from "@/lib/extensionDestination";

it("does not silently route an old extension's unspecified import to the board for a Room Design project", () => {
  expect(() => extensionImportDestination({}, true)).toThrow("Nothing was imported");
});
it("uses complete room/item scope when a legacy request omitted only its destination", () => {
  expect(extensionImportDestination({ roomId: "kitchen", requiredItemKey: "flooring" }, true)).toBe(
    "room_design",
  );
});
it("keeps explicit board imports available on new-process projects", () => {
  expect(
    extensionImportDestination(
      { destination: "design_board", roomId: "kitchen", requiredItemKey: "flooring" },
      true,
    ),
  ).toBe("design_board");
});
it("keeps legacy board imports available on existing-process projects", () => {
  expect(extensionImportDestination({}, false)).toBe("design_board");
});
it("rejects an unsupported destination rather than substituting a board", () => {
  expect(() => extensionImportDestination({ destination: "room_design_v99" }, true)).toThrow(
    "unrecognized destination",
  );
});
