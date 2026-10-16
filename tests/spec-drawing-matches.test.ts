import { describe, it, expect, vi, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
vi.mock("@/lib/specDrawingText.server", () => ({
  extractDrawingPageText: async (_bytes: Uint8Array, pages: number) =>
    Array.from({ length: pages }, (_, i) => ({ page: i + 1, text: "" })),
}));
import {
  cleanDrawingMatchChunk,
  drawingMatchItems,
  drawingMatchPageGroups,
  drawingMatchReport,
  drawingMatchSignature,
  nativeDrawingMatches,
  drawingChunkCandidates,
  drawingSkuAppears,
  drawingRoomHeadings,
  applyDrawingRoomLabels,
  drawingRoomLabelPages,
  drawingMatchesWithRoomFallback,
  type DrawingMatchJob,
} from "@/lib/specDrawingMatches";
import {
  prepareDrawingMatchScan,
  startDrawingMatchChunk,
  collectDrawingMatchChunk,
  loadDrawingMatchReport,
  type DrawingMatchStore,
} from "@/lib/specDrawingMatchEngine.server";
const item = {
  id: "item-a",
  ref: "S1",
  roomId: "room-a",
  room: "Bathroom Two",
  label: "Shower wall",
  name: "Nieve Punto",
  sku: "EZTIER0520",
  vendor: "Tiles of Ezra",
  finish: "Glazed",
  dimensions: "2 × 8",
  cad: "",
};
const doc = {
  id: "doc",
  title: "Current drawings",
  updated_at: "2026-10-15",
  file_url: "path.pdf",
  file_size: 100,
};
const job: DrawingMatchJob = {
  version: 1,
  mode: "ai",
  key: "scan",
  projectId: "project",
  createdBy: "user",
  createdAt: "2026-10-15",
  status: "queued",
  document: doc,
  items: [item],
};
const row = (patch = {}) => ({
  item: "S1",
  roomId: "room-a",
  page: 1,
  sheet: "79",
  views: ["48"],
  title: "Shower wall",
  evidence: "EZTIER0520 NIEVE PUNTO — BATH 2",
  basis: "sku",
  roomVerified: true,
  confidence: "high",
  bounds: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.8 },
  ...patch,
});
const raw = (matches = [row()], pages = [1]) => ({
  complete: true,
  reviewedPages: pages,
  matches,
  uncertainties: [],
});
function completed(value: any) {
  return {
    status: "completed",
    output_text: JSON.stringify(value),
    usage: { input_tokens: 200, output_tokens: 400 },
  };
}
async function storage(pages = 1) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  const bytes = await pdf.save();
  const records = new Map<string, any>([["scan/job.json", structuredClone(job)]]);
  const binaries = new Map<string, Uint8Array>();
  const store: DrawingMatchStore = {
    read: async (path) => structuredClone(records.get(path) || null),
    write: async (path, value, exclusive) => {
      if (exclusive && records.has(path)) return false;
      records.set(path, structuredClone(value));
      return true;
    },
    readBytes: async (path) => binaries.get(path)!,
    writeBytes: async (path, bytes) => {
      binaries.set(path, bytes);
    },
    sourceBytes: async () => bytes,
    current: async () => true,
  };
  return { store, records };
}
afterEach(() => vi.unstubAllEnvs());
describe("grounded item-to-drawing matches", () => {
  it("labels the actual printed sheet rather than an inline reference to another drawing", () => {
    const pages = [
      { page: 19, text: "BATH 2 ELEVATION\n17\nID\n...\nSee hood detail ID19\nNIEVE PUNTO" },
    ];
    expect(nativeDrawingMatches(pages, [item])[0]).toMatchObject({ page: 19, sheet: "17" });
    expect(drawingMatchesWithRoomFallback(pages, [item], [])[0]).toMatchObject({
      page: 19,
      sheet: "17",
    });
  });
  it("shows every matching room sheet when the item name/SKU is not identified", () => {
    const faucet = { ...item, name: "Unprinted faucet name", label: "Faucet", sku: "catalog-only" };
    const pages = [
      { page: 1, text: "BATH 2 ELEVATION\nID 78\nSTONE WALL" },
      { page: 2, text: "BATH 2 SHOWER WALL\nID 79" },
      { page: 3, text: "BATH 3 ELEVATION\nID 80" },
    ];
    const matches = drawingMatchesWithRoomFallback(pages, [faucet], []);
    expect(matches.map((match) => [match.page, match.sheet, match.kind])).toEqual([
      [1, "78", "room"],
      [2, "79", "room"],
    ]);
    expect(
      matches.every(
        (match) => match.room === "Bathroom Two" && match.basis === "room" && match.bounds === null,
      ),
    ).toBe(true);
  });
  it("keeps confirmed product references focused instead of adding other room pages", () => {
    const pages = [
      { page: 1, text: "BATH 2 ELEVATION\nNIEVE PUNTO" },
      { page: 2, text: "BATH 2 SHOWER WALL" },
    ];
    const direct = nativeDrawingMatches(pages, [item]);
    expect(
      drawingMatchesWithRoomFallback(pages, [item], direct).map((match) => [
        match.page,
        match.kind,
      ]),
    ).toEqual([[1, "product"]]);
  });
  it("uses OCR room headings, deduplicates pages, and replaces uncertain off-room references with room context", () => {
    const pages = [
      { page: 1, text: "T 2 ELEVATION\nID 78" },
      { page: 2, text: "NIEVE PUNTO" },
    ];
    const labels = drawingRoomHeadings(
      1,
      [{ text: "BATH 2 ELEVATION", confidence: 95 }],
      [item],
      "page_ocr",
    );
    const matches = drawingMatchesWithRoomFallback(
      pages,
      [item],
      nativeDrawingMatches(pages, [item]),
      [...labels, ...labels],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      page: 1,
      kind: "room",
      roomSource: "page_ocr",
      roomEvidence: "BATH 2 ELEVATION",
    });
  });
  it("shows the whole room even when only one generic fixture callout was found", () => {
    const faucet = { ...item, name: "Faucet", label: "Faucet", sku: "" };
    const pages = [
      { page: 1, text: "BATH 2 ELEVATION\nFAUCET" },
      { page: 2, text: "BATH 2 PLAN" },
    ];
    const direct = nativeDrawingMatches(pages, [faucet]);
    expect(direct[0].kind).toBe("location");
    expect(
      drawingMatchesWithRoomFallback(pages, [faucet], direct).map((match) => [
        match.page,
        match.kind,
      ]),
    ).toEqual([
      [1, "room"],
      [2, "room"],
    ]);
  });
  it("excludes demolition/index sheets and incidental room notes from room fallbacks", () => {
    const pages = [
      { page: 1, text: "BATH 2 DEMOLITION PLAN\nBATH 2 ELEVATION" },
      { page: 2, text: "SHEET INDEX\nBATH 2 ELEVATION" },
      { page: 3, text: "Note: match trim in Bath 2" },
    ];
    expect(drawingMatchesWithRoomFallback(pages, [item], [])).toEqual([]);
  });
  it("matches placement-qualified labels to unique room fixture callouts, excluding bulbs and accessories", () => {
    const fixture = {
      ...item,
      name: "Greeley Sconce",
      label: "Range Sconces",
      sku: "",
      room: "Kitchen",
    };
    const bulb = { ...fixture, id: "bulb", name: "Sconce bulbs", label: "Sconce bulbs" };
    const matches = nativeDrawingMatches(
      [{ page: 1, text: "KITCHEN ELEVATION\nKITCHEN SCONCE" }],
      [fixture, bulb],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ itemId: fixture.id, basis: "room_item", kind: "location" });
  });
  it("does not mistake a light over a sink for the sink itself", () => {
    const light = {
      ...item,
      name: "flush mount over sink",
      label: "flush mount over sink",
      room: "Kitchen",
      sku: "",
    };
    const sink = { ...light, id: "sink", name: "Sink", label: "Sink" };
    const [match] = nativeDrawingMatches(
      [{ page: 1, text: "KITCHEN ELEVATION\nSINK WALL" }],
      [light, sink],
    );
    expect(match).toMatchObject({ itemId: "sink", kind: "location" });
    expect(
      nativeDrawingMatches([{ page: 1, text: "KITCHEN ELEVATION\nFLUSH MOUNT OVER SINK" }], [sink]),
    ).toEqual([]);
  });
  it("recognizes kitchen plan/RCP and detail titles while rejecting product descriptions", () => {
    const kitchen = { ...item, room: "Kitchen" };
    const labels = drawingRoomHeadings(
      15,
      [
        { text: "KITCHEN PLAN & RCP", confidence: 99 },
        { text: "KITCHEN HOOD DETAIL", confidence: 99 },
      ],
      [kitchen],
      "page_ocr",
    );
    expect(labels).toHaveLength(1);
    expect(
      drawingRoomHeadings(
        15,
        [{ text: "KITCHEN FAUCET POLISHED CHROME", confidence: 99 }],
        [kitchen],
        "page_ocr",
      ),
    ).toEqual([]);
  });
  it("does not attach a name to an unrelated room when a sheet has multiple known headings", () => {
    const other = { ...item, id: "bath3", roomId: "bath3", room: "Bathroom Three" };
    const kitchen = { ...item, id: "k", roomId: "k", room: "Kitchen" };
    expect(
      nativeDrawingMatches(
        [{ page: 1, text: "BATH 2 ELEVATION\nBATH 3 ELEVATION\nNIEVE PUNTO" }],
        [item, other, kitchen],
      ).map((m) => m.itemId),
    ).toEqual([item.id, other.id]);
  });
  it("matches product names across line breaks without a SKU and keeps bathrooms separate", () => {
    const other = { ...item, id: "bath3", roomId: "bath3", room: "Bathroom Three" };
    const found = nativeDrawingMatches(
      [
        { page: 1, text: "BATH 2 ELEVATION\nTIERRA BASICS\nNIEVE PUNTO\nSIZE 2 X 8" },
        { page: 2, text: "BATH 3 ELEVATION\nNIEVE PUNTO" },
      ],
      [item, other],
    );
    expect(found.map((m) => [m.itemId, m.page, m.basis, m.kind])).toEqual([
      [item.id, 1, "product_name", "product"],
      [other.id, 2, "product_name", "product"],
    ]);
  });
  it("matches punctuation, singular/plural callouts and RoughCut spelling without equating generic colors", () => {
    const stone = {
      ...item,
      roomId: "k",
      room: "Kitchen",
      sku: "catalog-only",
      name: "Eldorado - Casa Blanca RoughCut",
      label: "Stone",
    };
    const faucet = { ...stone, id: "faucet", name: "Traditional Faucet", label: "Faucet" };
    const white = { ...stone, id: "white", name: "White", label: "White" };
    const matches = nativeDrawingMatches(
      [
        {
          page: 1,
          text: "KITCHEN ELEVATION\nELDORADO STONE CASA BLANCA\nROUGH CUT INSTALLED TO CEILING\nWHITE OAK CABINETS\nFAUCETS",
        },
      ],
      [stone, faucet, white],
    );
    expect(matches.find((m) => m.itemId === stone.id)).toMatchObject({
      basis: "product_name",
      kind: "product",
    });
    expect(matches.find((m) => m.itemId === faucet.id)).toMatchObject({
      basis: "room_item",
      kind: "location",
    });
    expect(matches.some((m) => m.itemId === white.id)).toBe(false);
  });
  it("uses the client-facing name and retains quoted name evidence", () => {
    const named = {
      ...item,
      name: "Internal product",
      clientName: "Tierra Basics Nieve Punto",
      sku: "",
    };
    const [match] = nativeDrawingMatches(
      [{ page: 1, text: "BATH 2 ELEVATION\nTIERRA BASICS NIEVE PUNTO" }],
      [named],
    );
    expect(match).toMatchObject({ kind: "product", basis: "product_name" });
    expect(match.evidence).toContain("TIERRA BASICS NIEVE PUNTO");
  });
  it("requires a room heading for generic fixtures and never links a toilet from its paper holder", () => {
    const fixture = { ...item, name: "Toilet", label: "Toilet", sku: "" };
    expect(nativeDrawingMatches([{ page: 1, text: "TOILET" }], [fixture])).toEqual([]);
    expect(nativeDrawingMatches([{ page: 1, text: "Note: Bath 2\nTOILET" }], [fixture])).toEqual(
      [],
    );
    expect(
      nativeDrawingMatches([{ page: 1, text: "BATH 2 ELEVATION\nTOILET PAPER HOLDER" }], [fixture]),
    ).toEqual([]);
    expect(
      nativeDrawingMatches([{ page: 1, text: "BATH 2 ELEVATION\nTOILET" }], [fixture])[0],
    ).toMatchObject({ kind: "location", basis: "room_item" });
  });
  it("keeps ambiguous fixture callouts unconfirmed and does not promote them to exact products", () => {
    const fixture = { ...item, name: "Pendant", label: "Pendant", sku: "" };
    const other = { ...fixture, id: "second" };
    const matches = nativeDrawingMatches(
      [{ page: 1, text: "BATH 2 ELEVATION\nPENDANT" }],
      [fixture, other],
    );
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.kind === "review" && m.basis === "room_item")).toBe(true);
    const labels = drawingRoomHeadings(
      1,
      [{ text: "BATH 2 ELEVATION", confidence: 100 }],
      [fixture],
      "page_ocr",
    );
    expect(
      applyDrawingRoomLabels(matches, labels, [fixture, other]).every((m) => m.kind === "review"),
    ).toBe(true);
  });
  it("reads damaged room headings even when no SKU or name has matched yet, then finds room callouts", () => {
    const fixture = {
      ...item,
      roomId: "k",
      room: "Kitchen",
      name: "Faucet",
      label: "Faucet",
      sku: "",
    };
    const pages = [{ page: 16, text: "I E ELEVATION\nFAUCET\nID 14" }];
    expect(drawingRoomLabelPages(pages, [fixture], [])).toEqual([16]);
    const labels = drawingRoomHeadings(
      16,
      [{ text: "KITCHEN ELEVATION", confidence: 94 }],
      [fixture],
      "page_ocr",
    );
    expect(nativeDrawingMatches(pages, [fixture], labels)[0]).toMatchObject({
      kind: "location",
      room: "Kitchen",
      roomSource: "page_ocr",
    });
  });
  it("reads a numbered bathroom from a visible room heading and records it on the matched sheet", () => {
    const labels = drawingRoomHeadings(
      80,
      [
        { text: "BATH 2 - VANITY WALL", confidence: 94 },
        { text: "BATH 2 ELEVATION", confidence: 93 },
      ],
      [item],
      "page_ocr",
    );
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      room: "Bathroom Two",
      roomId: item.roomId,
      source: "page_ocr",
    });
    const matches = nativeDrawingMatches(
      [{ page: 80, text: "T 2 ELEVATION\nSKU: EZTIER0520" }],
      [item],
    );
    expect(matches[0].kind).toBe("review");
    expect(applyDrawingRoomLabels(matches, labels, [item])[0]).toMatchObject({
      kind: "product",
      room: "Bathroom Two",
      roomSource: "page_ocr",
      roomEvidence: "BATH 2 ELEVATION",
    });
  });
  it("uses room headings over incidental room mentions in sheet notes", () => {
    const other = { ...item, id: "kitchen-item", roomId: "kitchen", room: "Kitchen" };
    const matches = nativeDrawingMatches(
      [{ page: 1, text: "BATH 2 ELEVATION\nNote: match trim used in Kitchen\nSKU: EZTIER0520" }],
      [item, other],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      itemId: item.id,
      kind: "product",
      room: "Bathroom Two",
      roomSource: "pdf_heading",
    });
  });
  it("does not infer a room from low-confidence OCR, a partial title or a product description", () => {
    const lines = [
      { text: "BATH 2 ELEVATION", confidence: 60 },
      { text: "T 2 ELEVATION", confidence: 98 },
      { text: "Fits Bath 2", confidence: 98 },
      { text: "Bath 2 faucet polished chrome", confidence: 99 },
    ];
    expect(drawingRoomHeadings(80, lines, [item], "page_ocr")).toEqual([]);
  });
  it("leaves shared sheets unconfirmed and removes cross-room SKU duplicates only with one clear heading", () => {
    const other = { ...item, id: "bath3", roomId: "bath3", room: "Bathroom Three" };
    const matches = nativeDrawingMatches([{ page: 1, text: "EZTIER0520" }], [item, other]);
    const one = drawingRoomHeadings(
      1,
      [{ text: "BATH 2 ELEVATION", confidence: 95 }],
      [item, other],
      "page_ocr",
    );
    expect(applyDrawingRoomLabels(matches, one, [item, other]).map((m) => m.itemId)).toEqual([
      item.id,
    ]);
    const mixed = drawingRoomHeadings(
      1,
      [
        { text: "BATH 2 ELEVATION", confidence: 95 },
        { text: "BATH 3 ELEVATION", confidence: 95 },
      ],
      [item, other],
      "page_ocr",
    );
    expect(
      applyDrawingRoomLabels(matches, mixed, [item, other]).every((m) => m.kind === "review"),
    ).toBe(true);
  });
  it("indexes every exact tile SKU occurrence without AI and keeps different bathrooms separate", () => {
    const other = {
      ...item,
      id: "item-other",
      ref: "S2",
      roomId: "room-b",
      room: "Bathroom Three",
    };
    const found = nativeDrawingMatches(
      [
        { page: 78, text: "BATH 2 ELEVATION\nSKU: EZTIER0520\nSIZE: 2 X 8\nID 78" },
        { page: 79, text: "BATH 2 SHOWER WALL\nEZTIER0520\nID 79" },
        { page: 80, text: "BATH 3 ELEVATION\nEZTIER0520" },
      ],
      [item, other],
    );
    expect(found.filter((m) => m.itemId === item.id).map((m) => m.page)).toEqual([78, 79]);
    expect(found.filter((m) => m.itemId === other.id).map((m) => m.page)).toEqual([80]);
    expect(found.every((m) => m.kind === "product")).toBe(true);
  });
  it("does not mistake a longer SKU or demolition callout for the selected installation", () => {
    expect(drawingSkuAppears("SH4001", "SH40012")).toBe(false);
    expect(drawingSkuAppears("SH4001", "SKU: SH4001")).toBe(true);
    expect(
      nativeDrawingMatches([{ page: 1, text: "BATH 2 DEMOLITION PLAN\nEZTIER0520" }], [item]),
    ).toEqual([]);
  });
  it("narrows only explicit single-room elevations and retains every candidate on mixed or unreadable pages", () => {
    const other = { ...item, id: "other", ref: "S2", roomId: "other", room: "Kitchen" };
    expect(drawingChunkCandidates([{ page: 1, text: "BATH 2 ELEVATION" }], [item, other])).toEqual([
      item,
    ]);
    expect(
      drawingChunkCandidates([{ page: 1, text: "BATH 2 KITCHEN FLOOR PLAN" }], [item, other]),
    ).toHaveLength(2);
    expect(drawingChunkCandidates([{ page: 1, text: "" }], [item, other])).toHaveLength(2);
  });
  it("preserves both physical pages independently of printed sheet and elevation numbers", () => {
    const result = cleanDrawingMatchChunk(
      raw(
        [
          row({ page: 1, sheet: "79", views: ["48", "49"] }),
          row({ page: 2, sheet: "78", views: ["47"] }),
        ],
        [1, 2],
      ),
      [80, 81],
      [item],
    );
    expect(result.matches.map((m) => [m.page, m.sheet, m.views])).toEqual([
      [80, "79", ["48", "49"]],
      [81, "78", ["47"]],
    ]);
  });
  it("combines repeated elevations on one page while retaining both callouts", () => {
    const result = cleanDrawingMatchChunk(
      raw([row(), row({ views: ["49"], evidence: "EZTIER0520 on the return shower wall" })]),
      [12],
      [item],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].views).toEqual(["48", "49"]);
    expect(result.matches[0].evidence).toContain("return shower wall");
  });
  it.each([
    raw([row({ item: "S999" })]),
    raw([row({ roomId: "other-bathroom" })]),
    raw([row({ page: 79 })]),
    { ...raw(), reviewedPages: [1, 1] },
    { ...raw(), complete: false },
  ])("rejects ungrounded item/room/page and incomplete coverage", (value) =>
    expect(() => cleanDrawingMatchChunk(value, [10], [item])).toThrow(),
  );
  it("keeps ambiguous retail identity reviewable instead of asserting a product match", () => {
    expect(
      cleanDrawingMatchChunk(raw([row({ evidence: "white tile", basis: "sku" })]), [1], [item])
        .matches[0].kind,
    ).toBe("review");
    expect(
      cleanDrawingMatchChunk(
        raw([row({ basis: "room_item", evidence: "BATH 2 SHOWER WALL TILE" })]),
        [1],
        [item],
      ).matches[0].kind,
    ).toBe("location");
    expect(
      cleanDrawingMatchChunk(
        raw([row({ basis: "room_item" })]),
        [1],
        [item, { ...item, id: "second", ref: "S2" }],
      ).matches[0].kind,
    ).toBe("review");
  });
  it("invalidates a changed document/room/SKU while ignoring image/price/quantity changes", () => {
    const key = drawingMatchSignature("p", doc, [item]);
    expect(drawingMatchSignature("p", { ...doc, updated_at: "new" }, [item])).not.toBe(key);
    expect(drawingMatchSignature("p", doc, [{ ...item, sku: "new" }])).not.toBe(key);
    expect(drawingMatchSignature("p", doc, [{ ...item, image: "new.jpg" }])).toBe(key);
    const base = {
      id: item.id,
      room_id: item.roomId,
      item_label: item.label,
      product_id: "product",
      product: { name: item.name, sku: item.sku, price: "100" },
      quantity: 1,
    };
    const rooms = [{ id: item.roomId, name: item.room }];
    expect(drawingMatchItems([base], rooms)).toEqual(
      drawingMatchItems(
        [{ ...base, quantity: 20, product: { ...base.product, price: "200" } }],
        rooms,
      ),
    );
  });
  it("accounts for the final partial page group and never calls partial results complete", () => {
    expect(drawingMatchPageGroups(10)).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 10],
    ]);
    expect(() => drawingMatchPageGroups(161)).toThrow();
    const j = { ...job, status: "ready" as const, pages: 10, chunks: drawingMatchPageGroups(10) };
    expect(
      drawingMatchReport(
        j,
        [{ pages: [1, 2, 3, 4, 5, 6, 7, 8], matches: [], uncertainties: [] }, null],
        ["stopped"],
      ).status,
    ).toBe("partial");
  });
});
describe("saved, cost-bounded drawing scan", () => {
  it("defaults to direct matching across 88 pages without any AI request or page uploads", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { store } = await storage(88);
    await store.write("scan/job.json", { ...job, mode: undefined });
    const fetcher = vi.fn(() => {
      throw Error("Unexpected network request");
    });
    const upload = vi.spyOn(store, "writeBytes");
    expect(await prepareDrawingMatchScan(store, "scan", fetcher)).toBe(0);
    expect(await prepareDrawingMatchScan(store, "scan", fetcher)).toBe(0);
    const report = await loadDrawingMatchReport(store, "scan");
    expect(report).toMatchObject({
      mode: "direct",
      status: "complete",
      indexedPages: 88,
      ceilingUsd: 0,
      totalChunks: 0,
    });
    expect(report?.reviewedPages).toEqual([]);
    await expect(startDrawingMatchChunk(store, "scan", 0, fetcher)).rejects.toThrow(/direct PDF/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it("preflights every page group before generation and refuses an aggregate above $5", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { store } = await storage(80);
    const fetcher = vi.fn(async () => Response.json({ input_tokens: 260000 }));
    await expect(prepareDrawingMatchScan(store, "scan", fetcher as typeof fetch)).rejects.toThrow(
      /exceeds.*budget/,
    );
    expect(fetcher.mock.calls.every((call) => String(call[0]).endsWith("input_tokens"))).toBe(true);
  });
  it("saves results and a second click never repeats the generation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { store } = await storage();
    const count = vi.fn(async () => Response.json({ input_tokens: 200 }));
    await prepareDrawingMatchScan(store, "scan", count as typeof fetch);
    const generate = vi.fn(async () => Response.json(completed(raw())));
    expect(await startDrawingMatchChunk(store, "scan", 0, generate as typeof fetch)).toBe(
      "complete",
    );
    expect(await startDrawingMatchChunk(store, "scan", 0, generate as typeof fetch)).toBe(
      "complete",
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await loadDrawingMatchReport(store, "scan"))?.status).toBe("complete");
    expect((await loadDrawingMatchReport(store, "scan"))?.matches[0].kind).toBe("product");
  });
  it("collects an existing background result without starting a new paid request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { store } = await storage();
    await prepareDrawingMatchScan(
      store,
      "scan",
      vi.fn(async () => Response.json({ input_tokens: 200 })) as typeof fetch,
    );
    const generate = vi.fn(async () => Response.json({ status: "queued", id: "resp_test" }));
    await startDrawingMatchChunk(store, "scan", 0, generate as typeof fetch);
    await startDrawingMatchChunk(store, "scan", 0, generate as typeof fetch);
    expect(generate).toHaveBeenCalledTimes(1);
    const retrieve = vi.fn(async () => Response.json(completed(raw())));
    expect(await collectDrawingMatchChunk(store, "scan", 0, retrieve)).toBe("complete");
    expect(retrieve).toHaveBeenCalledWith("resp_test");
  });
  it("retains an uncertain send as failed and never retries it automatically", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { store } = await storage();
    await prepareDrawingMatchScan(
      store,
      "scan",
      vi.fn(async () => Response.json({ input_tokens: 200 })) as typeof fetch,
    );
    const send = vi.fn(async () => {
      throw Error("connection lost");
    });
    expect(await startDrawingMatchChunk(store, "scan", 0, send as typeof fetch)).toBe("failed");
    await startDrawingMatchChunk(store, "scan", 0, send as typeof fetch);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await loadDrawingMatchReport(store, "scan"))?.status).toBe("failed");
  });
  it("stops before sending when the source changes", async () => {
    const { store } = await storage();
    store.current = async () => false;
    const send = vi.fn();
    await expect(prepareDrawingMatchScan(store, "scan", send)).rejects.toThrow(/changed/);
    expect(send).not.toHaveBeenCalled();
  });
});
