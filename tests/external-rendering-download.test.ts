import { expect, it } from "vitest";
import { unzipSync } from "fflate";
import type { RoomImage } from "@/lib/db";
import {
  buildExternalRenderingZip,
  externalRenderingCandidates,
  renderingDownloadEntries,
} from "@/lib/externalRenderingDownload";

const rooms = [
  { id: "k", name: "Kitchen", sort_order: 0 },
  { id: "b", name: "Bathroom", sort_order: 1 },
];
const image = (id: string, patch: Partial<RoomImage> = {}): RoomImage =>
  ({
    id,
    room_id: "k",
    kind: "rendering",
    status: "complete",
    url: `https://example.com/${id}`,
    caption: id,
    rendering_source: "external",
    is_approved: true,
    sort_order: 0,
    ...patch,
  }) as RoomImage;

it("exports only approved complete renderings in project rooms, including older and generated images", () => {
  expect(
    externalRenderingCandidates(
      [
        image("external"),
        image("older", { rendering_source: null }),
        image("generated", { rendering_source: "generated", is_approved: true }),
        image("imported", { rendering_source: "imported" }),
        image("draft", { is_approved: false, review_status: "draft" }),
        image("needs-review", { is_approved: false, review_status: "needs_revision" }),
        image("approved-status", { is_approved: false, review_status: "approved" }),
        image("queued", { status: "queued" }),
        image("sketchup", { kind: "sketchup" }),
        image("other-project", { room_id: "elsewhere" }),
      ],
      rooms,
    ).map((item) => item.id),
  ).toEqual(["external", "older", "generated", "imported", "approved-status"]);
});

it("automatically includes approved older images and numbers originals per room in a stable order", () => {
  const images = [
    image("two", { sort_order: 2 }),
    image("one", { sort_order: 1 }),
    image("bath", { room_id: "b" }),
    image("old", { rendering_source: null }),
  ];
  const entries = renderingDownloadEntries(
    "Rinehart Reno",
    rooms,
    images,
    new Set(["one", "two", "bath"]),
  );
  expect(entries.map((entry) => entry.filenameStem)).toEqual([
    "Rinehart Reno Kitchen 1",
    "Rinehart Reno Kitchen 2",
    "Rinehart Reno Bathroom 1",
  ]);
  expect(renderingDownloadEntries("Project", rooms, images, new Set(["old"]))[0].image.id).toBe(
    "old",
  );
  expect(renderingDownloadEntries("Project", rooms, images).map((entry) => entry.image.id)).toEqual(
    ["old", "one", "two", "bath"],
  );
});

it("avoids duplicate archive paths even when room names sanitize to the same name", () => {
  const duplicateRooms = [
    { id: "k", name: "Kitchen / Bar" },
    { id: "b", name: "kitchen \\ bar" },
  ];
  const entries = renderingDownloadEntries(
    "Project: Name",
    duplicateRooms,
    [image("a"), image("b", { room_id: "b" })],
    new Set(["a", "b"]),
  );
  expect(new Set(entries.map((entry) => entry.filenameStem.toLowerCase())).size).toBe(2);
  expect(entries.every((entry) => !/[/:\\]/.test(entry.filenameStem))).toBe(true);
});

it("keeps original image bytes and extensions instead of renaming every file PNG", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const jpg = new Uint8Array([255, 216, 255, 1]);
  const images = [image("png", { sort_order: 0 }), image("jpg", { sort_order: 1 })];
  const entries = renderingDownloadEntries("Project", rooms, images, new Set(["png", "jpg"]));
  const progress: number[] = [];
  const fetcher = (async (url: string) =>
    new Response(url.endsWith("png") ? png : jpg)) as typeof fetch;
  const result = await buildExternalRenderingZip(
    "Project",
    entries,
    (value) => progress.push(value),
    fetcher,
  );
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  expect(result.filename).toBe("Project Approved Renderings.zip");
  expect(files["Project Kitchen 1.png"]).toEqual(png);
  expect(files["Project Kitchen 2.jpg"]).toEqual(jpg);
  expect(progress.sort()).toEqual([1, 2]);
});

it("rejects failed downloads and non-image responses instead of silently omitting images", async () => {
  const entries = renderingDownloadEntries("Project", rooms, [image("a")], new Set(["a"]));
  for (const response of [
    new Response("missing", { status: 404 }),
    new Response("<html>Sign in</html>"),
  ]) {
    await expect(
      buildExternalRenderingZip(
        "Project",
        entries,
        () => {},
        (async () => response) as typeof fetch,
      ),
    ).rejects.toThrow("No ZIP was downloaded");
  }
});
