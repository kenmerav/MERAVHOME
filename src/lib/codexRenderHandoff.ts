export type CodexRenderSelection = {
  category: string;
  productName: string;
  vendor: string;
  finish: string;
  source: string;
  state: string;
  url?: string;
  group?: string;
  quantity?: number;
  notes?: string;
};

export type CodexRenderAttachment = {
  filename: string;
  purpose: "room-photo" | "floor-plan" | "concept-board" | "sketchup-view";
};

export type CodexRenderHandoff = {
  version: 1;
  createdAt: string;
  projectName: string;
  roomName: string;
  outputFilename: string;
  attachments: CodexRenderAttachment[];
  selections: CodexRenderSelection[];
  instructions: string[];
};

export type CodexProjectRenderRoom = {
  folder: string;
  handoff: CodexRenderHandoff;
};

export type CodexProjectRenderHandoff = {
  version: 1;
  createdAt: string;
  projectName: string;
  rooms: CodexProjectRenderRoom[];
};

export function codexRenderHandoffBaseName(projectName: string, roomName: string) {
  return [projectName, roomName, "codex-render-handoff"]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export function codexProjectRenderHandoffBaseName(projectName: string) {
  return [projectName, "all-rooms", "codex-render-handoff"]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export function codexRenderRoomFolder(roomName: string, index: number) {
  const roomSlug = roomName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return `${String(index + 1).padStart(2, "0")}-${roomSlug || "room"}`;
}

export function createCodexRenderHandoff({
  projectName,
  roomName,
  selections,
  attachments,
  outputFilename: requestedOutputFilename,
  createdAt = new Date().toISOString(),
}: {
  projectName: string;
  roomName: string;
  selections: CodexRenderSelection[];
  attachments: CodexRenderAttachment[];
  outputFilename?: string;
  createdAt?: string;
}): CodexRenderHandoff {
  const hasRoomPhoto = attachments.some((attachment) => attachment.purpose === "room-photo");
  const hasFloorPlan = attachments.some((attachment) => attachment.purpose === "floor-plan");
  const outputFilename =
    requestedOutputFilename ?? `${codexRenderHandoffBaseName(projectName, roomName)}-render.png`;

  return {
    version: 1,
    createdAt,
    projectName,
    roomName,
    outputFilename,
    attachments,
    selections,
    instructions: [
      hasRoomPhoto
        ? "Use the attached room photo as the architectural and camera source of truth. Preserve walls, openings, cabinetry geometry, plumbing locations, proportions, and perspective unless the handoff explicitly says otherwise."
        : "No room photo is attached. Create a concept rendering for the named room and do not claim that it preserves an existing room layout.",
      hasFloorPlan
        ? "Use the attached floor plan as a secondary layout constraint. The room photo controls visible perspective where the two references differ."
        : "No floor plan is attached.",
      "Treat every selected or locked product as a required override, not optional inspiration. Visit the supplied product URL when the handoff lacks enough visual detail.",
      "Do not substitute generic mirrors, sconces, faucets, stone, tile, hardware, or fixtures for products identified in the selection list.",
      "For mirrors and sconces, match the selected shape, proportions, orientation, shade, backplate, and finish. For materials, match color, pattern, scale, sheen, and installation direction.",
      "Keep drains, rough-ins, hooks, and other small accessories visually subordinate to the primary fixtures.",
      `Create one client-presentable photorealistic rendering and save it as ${outputFilename}.`,
      "After creating the image, return it to the designer for review. Do not order products or change approved Studio records.",
    ],
  };
}

export function buildCodexRenderHandoffMarkdown(handoff: CodexRenderHandoff) {
  const attachments = handoff.attachments.length
    ? handoff.attachments
        .map(
          (attachment) => `- \`${attachment.filename}\` — ${attachmentPurpose(attachment.purpose)}`,
        )
        .join("\n")
    : "- None. This will be a concept rendering rather than an architecture-preserving edit.";
  const selections = handoff.selections.length
    ? handoff.selections
        .map((selection, index) => {
          const details = [
            `**${index + 1}. ${selection.category}**`,
            selection.productName ? `Product: ${selection.productName}` : "Product: Needs review",
            selection.vendor ? `Vendor: ${selection.vendor}` : "",
            selection.finish ? `Finish: ${selection.finish}` : "",
            selection.url ? `Product URL: ${selection.url}` : "",
            selection.group ? `Board group: ${selection.group}` : "",
            selection.quantity ? `Quantity: ${selection.quantity}` : "",
            `Selection state: ${selection.state}`,
            `Source: ${selection.source}`,
            selection.notes ? `Designer notes: ${selection.notes}` : "",
          ].filter(Boolean);
          return details.join("  \n");
        })
        .join("\n\n")
    : "No products were included. Stop and ask the designer to complete the room selections.";

  return `# MERAV Studio — Codex Render Handoff

## Assignment

Create one client-presentable rendering for **${handoff.projectName} — ${handoff.roomName}** using the attachments and exact product selections in this package.

This package was prepared by Studio on ${handoff.createdAt}. It is a reviewable handoff, not authorization to purchase anything or modify approved project data.

## Source files

${attachments}

## Rendering rules

${handoff.instructions.map((instruction, index) => `${index + 1}. ${instruction}`).join("\n")}

## Product selections

${selections}

## Required output

- Filename: \`${handoff.outputFilename}\`
- Format: PNG
- Direction: photorealistic interior-design presentation rendering
- Return the finished image to Studio using **Import completed Codex render**.
`;
}

export function createCodexProjectRenderHandoff({
  projectName,
  handoffs,
  createdAt = new Date().toISOString(),
}: {
  projectName: string;
  handoffs: CodexRenderHandoff[];
  createdAt?: string;
}): CodexProjectRenderHandoff {
  return {
    version: 1,
    createdAt,
    projectName,
    rooms: handoffs.map((handoff, index) => ({
      folder: codexRenderRoomFolder(handoff.roomName, index),
      handoff,
    })),
  };
}

export function buildCodexProjectRenderHandoffMarkdown(handoff: CodexProjectRenderHandoff) {
  const rooms = handoff.rooms
    .map(
      ({ folder, handoff: room }, index) =>
        `${index + 1}. **${room.roomName}** — open \`${folder}/README.md\` and return \`${room.outputFilename}\``,
    )
    .join("\n");

  return `# MERAV Studio — Project Render Handoff

## Assignment

Create the room renderings for **${handoff.projectName}**. Each room is a separate assignment with its own product selections, source images, layout rules, and required output filename.

This project package was prepared by Studio on ${handoff.createdAt}. It is a reviewable handoff, not authorization to purchase anything or modify approved project data.

## Workflow

1. Process the room folders below one at a time in the listed order.
2. Read each room's \`README.md\` before generating its image.
3. Keep one room's attachments and selections isolated from every other room.
4. Save every image using the exact required filename in that room's assignment.
5. Return all completed PNG files together. Studio will match them to rooms by filename using **Import project renders**.

## Rooms

${rooms || "No prepared rooms were included. Stop and ask the designer to prepare at least one room."}
`;
}

function attachmentPurpose(purpose: CodexRenderAttachment["purpose"]) {
  if (purpose === "room-photo") return "architectural and camera source of truth";
  if (purpose === "sketchup-view") return "CAD or SketchUp geometry and camera source of truth";
  if (purpose === "floor-plan") return "secondary layout constraint";
  return "design direction and palette reference";
}
