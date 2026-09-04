import { describe, expect, it } from "vitest";
import {
  buildCodexProjectRenderHandoffMarkdown,
  buildCodexRenderHandoffMarkdown,
  codexProjectRenderHandoffBaseName,
  codexRenderHandoffBaseName,
  createCodexProjectRenderHandoff,
  createCodexRenderHandoff,
} from "@/lib/codexRenderHandoff";

describe("Codex render handoff", () => {
  it("creates a portable filename", () => {
    expect(codexRenderHandoffBaseName("Hacienda Paradise", "Primary Bathroom")).toBe(
      "hacienda-paradise-primary-bathroom-codex-render-handoff",
    );
  });

  it("preserves exact links and room-layout rules in the handoff", () => {
    const handoff = createCodexRenderHandoff({
      projectName: "Hacienda Paradise",
      roomName: "Primary Bathroom",
      createdAt: "2026-08-29T12:00:00.000Z",
      attachments: [
        { filename: "room-photo.png", purpose: "room-photo" },
        { filename: "floor-plan.jpg", purpose: "floor-plan" },
      ],
      selections: [
        {
          category: "Mirror(s)",
          productName: "Clemente Arched Mirror",
          vendor: "Lulu and Georgia",
          finish: "Antique brass",
          source: "Product link",
          state: "locked",
          url: "https://example.com/clemente-mirror",
          quantity: 2,
        },
      ],
    });
    const markdown = buildCodexRenderHandoffMarkdown(handoff);

    expect(markdown).toContain("room photo as the architectural and camera source of truth");
    expect(markdown).toContain("https://example.com/clemente-mirror");
    expect(markdown).toContain("Quantity: 2");
    expect(markdown).toContain(handoff.outputFilename);
  });

  it("labels a package without a room photo as a concept rendering", () => {
    const handoff = createCodexRenderHandoff({
      projectName: "Test",
      roomName: "Powder Room",
      createdAt: "2026-08-29T12:00:00.000Z",
      attachments: [],
      selections: [],
    });

    expect(buildCodexRenderHandoffMarkdown(handoff)).toContain(
      "concept rendering rather than an architecture-preserving edit",
    );
  });

  it("accepts a unique batch filename for rooms with duplicate names", () => {
    const handoff = createCodexRenderHandoff({
      projectName: "Test",
      roomName: "Office",
      outputFilename: "12-test-office-render.png",
      attachments: [],
      selections: [],
    });

    expect(handoff.outputFilename).toBe("12-test-office-render.png");
  });

  it("creates one project assignment with isolated room folders and filenames", () => {
    const rooms = ["Primary Bathroom", "Kitchen"].map((roomName) =>
      createCodexRenderHandoff({
        projectName: "Hacienda Paradise",
        roomName,
        createdAt: "2026-08-29T12:00:00.000Z",
        attachments: [],
        selections: [
          {
            category: "Flooring",
            productName: `${roomName} floor`,
            vendor: "Studio vendor",
            finish: "Natural stone",
            source: "Product link",
            state: "selected",
          },
        ],
      }),
    );
    const handoff = createCodexProjectRenderHandoff({
      projectName: "Hacienda Paradise",
      handoffs: rooms,
      createdAt: "2026-08-29T12:00:00.000Z",
    });
    const markdown = buildCodexProjectRenderHandoffMarkdown(handoff);

    expect(codexProjectRenderHandoffBaseName("Hacienda Paradise")).toBe(
      "hacienda-paradise-all-rooms-codex-render-handoff",
    );
    expect(handoff.rooms.map((room) => room.folder)).toEqual(["01-primary-bathroom", "02-kitchen"]);
    expect(markdown).toContain(rooms[0].outputFilename);
    expect(markdown).toContain(rooms[1].outputFilename);
    expect(markdown).toContain("Keep one room's attachments and selections isolated");
  });
});
