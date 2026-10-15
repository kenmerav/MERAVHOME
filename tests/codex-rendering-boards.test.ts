import { expect, it } from "vitest";
import { codexBoardPages, codexBoardSvg } from "../src/lib/codexRenderingBoards";
const rooms = [
  { id: "one", name: "Bathroom One" },
  { id: "two", name: "Bathroom Two" },
];
it("keeps room patterns, common materials and visual notes without editing or leaking unrelated boards", () => {
  const state = {
    selectedPageId: "unrelated",
    comments: [{ body: "private comment" }],
    pages: [
      {
        id: "shared",
        title: "Materials Throughout",
        elements: [{ id: "paint", type: "text", text: "Greek Villa" }],
      },
      { id: "wrong", title: "Bathroom One", roomId: "two", elements: [] },
      {
        id: "one-board",
        title: "Bathroom One",
        roomId: "one",
        elements: [
          {
            id: "pattern",
            type: "image",
            src: "https://example.com/pattern.png",
            materialExcludeFromMaterials: true,
            notes: "basketweave",
            x: 10,
            y: 20,
            width: 200,
            height: 100,
          },
          { id: "hidden-image", type: "image", visible: false },
        ],
      },
      { id: "hidden", title: "Bathroom One", roomId: "one", hidden: true, elements: [] },
    ],
  };
  const before = JSON.stringify(state);
  const pages = codexBoardPages(state, ["one"], rooms);
  expect(pages.map((p) => p.id)).toEqual(["shared", "one-board"]);
  expect(pages[1].elements).toHaveLength(1);
  expect(pages[1].elements[0].notes).toBe("basketweave");
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.stringify(pages)).not.toContain("private comment");
  expect(codexBoardPages({ pages }, ["one"], rooms)).toEqual(pages);
  const svg = codexBoardSvg(pages[1], { pattern: "boards/images/floor.png" });
  expect(svg).toContain("../boards/images/floor.png");
  expect(svg).toContain('x="10"');
});
it("escapes board text in portable overviews", () => {
  const svg = codexBoardSvg(
    {
      id: "page",
      title: "Bath",
      roomId: null,
      pageNumber: 1,
      elements: [{ type: "text", text: '<script>alert("x")</script>' }],
    },
    {},
  );
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");
});
