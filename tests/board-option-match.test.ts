import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanBoardOptionMatch, prepareBoardOptions, publishedImageOptions, structuredImageOptions, boardOptionBatchCandidates, reusableBoardOptionMatch, runBoardOptionBatch } from "@/lib/boardOptionMatch";
const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const itemId = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
const state = vi.hoisted(() => ({ item: null as any, board: null as any, access: null as any, cached: null as any, model: vi.fn(), reserve: vi.fn(), settle: vi.fn(), budget: vi.fn(), freeze: vi.fn() }));
vi.mock("@/lib/specCompletion.server", () => ({ authorizeCompletionProject: async () => state.access }));
vi.mock("@/lib/specReviewAI.server", () => ({ fetchSpecReview: (...args: any[]) => state.model(...args), SpecReviewCostError: class extends Error {}, CreditsUnavailable: class extends Error {} }));
vi.mock("@/lib/boardOptionCache.server", () => ({ boardOptionSignature: () => "signature", readBoardOptionCache: async () => state.cached, saveBoardOptionCache: async () => true }));
vi.mock("@/lib/fullSpecBudget.server", () => ({ assertProductionFullSpecBudget: state.budget, productionFullSpecBudgetStore: () => ({}) }));
vi.mock("@/lib/fullSpecBudgetStore", () => ({ reserveFullSpecBudget: state.reserve, settleFullSpecBudget: state.settle }));
vi.mock("@/lib/immutableSpecImages.server", () => ({ immutableSpecImages: state.freeze }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "design_boards" ? { board_state: state.board } : state.item, error: null }) }; return q;
} } }));
import { matchBoardOption } from "@/lib/boardOptionMatch.server";
const html = `<button data-parent-id="color" data-text="Black"><img src="https://cdn.example.com/black.jpg"></button><button data-parent-id="color" data-text="Brass"><img src="https://cdn.example.com/brass.jpg"></button>`;
const request = () => new Request("https://studio.example/api/match-board-option", { method: "POST", body: "{}" });
beforeEach(() => {
  state.access = { projectId, userId: "11111111-1111-4111-8111-111111111111", body: { item_id: itemId, full_check_run_id: "33333333-3333-4333-8333-333333333333" }, user: { email: "ken@meravinteriors.com" }, profile: { email: "ken@meravinteriors.com", is_active: true, role: "Admin" } };
  state.cached = null;
  state.item = { id: itemId, project_id: projectId, room_id: "bath", item_label: "Knob", product_id: "p", product_url: "https://retailer.example/products/knob", product: { id: "p" }, source_board_id: projectId, source_board_page_id: "page", source_board_element_id: "element" };
  state.board = { pages: [{ id: "page", elements: [{ id: "element", type: "image", src: "https://cdn.example.com/board.jpg", materialItemId: itemId, productId: "p", materialRoomId: "bath" }] }] };
  state.reserve.mockReset(); state.reserve.mockResolvedValue(true); state.settle.mockReset(); state.settle.mockResolvedValue(undefined); state.budget.mockReset(); state.budget.mockResolvedValue({});
  state.freeze.mockReset(); state.freeze.mockImplementation(async (urls: string[], bytes = 0) => ({ images: urls.map(url => `data:image/png;base64,${btoa(url)}`), bytes: bytes + urls.length }));
  state.model.mockReset(); state.model.mockImplementation(async (...args: any[]) => { await args[4]({ ceilingUsd: 0.03 }); return Response.json({ status: "completed", output_text: JSON.stringify({ status: "matched", option_index: 1, confidence: 0.96, reason: "The shape and gold finish match." }) }); });
  vi.stubEnv("FIRECRAWL_API_KEY", "test"); vi.stubEnv("OPENAI_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { html } })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("compares the linked board image to complete retailer options and never changes the saved selection", async () => {
  const before = JSON.stringify(state.item);
  const result = await (await matchBoardOption(request())).json();
  expect(result).toMatchObject({ status: "matched", option: "Brass", boardImage: "https://cdn.example.com/board.jpg" });
  expect(result.options).toHaveLength(2); expect(JSON.stringify(state.item)).toBe(before);
  expect(state.reserve).toHaveBeenCalledTimes(2);
  expect(state.settle).toHaveBeenCalledTimes(2);
  expect(state.reserve.mock.calls[0][3]).toMatchObject({ openAiCents: 0, firecrawlCredits: 1 });
  expect(state.reserve.mock.calls[1][3]).toMatchObject({ openAiCents: 3, firecrawlCredits: 0 });
  expect(JSON.parse((fetch as any).mock.calls[0][1].body).parsers).toEqual([]);
  expect(state.model.mock.calls[0][0].input[0].content.filter((x: any) => x.type === "input_image")).toHaveLength(3);
  expect(state.model.mock.calls[0][0].input[0].content.filter((x: any) => x.type === "input_image").every((x: any) => x.image_url.startsWith("data:image/png;base64,"))).toBe(true);
});
it("leaves the match uncertain when confidence is low or the provider returns an invalid index", () => {
  const options = prepareBoardOptions({ Black: "a", Brass: "b" }, ["Black", "Brass"]);
  for (const result of [{ status: "matched", option_index: 1, confidence: 0.8, reason: "maybe" }, { status: "matched", option_index: 7, confidence: 1, reason: "yes" }])
    expect(cleanBoardOptionMatch(result, options, "board", "product").status).toBe("uncertain");
});
it("refuses partial or identical option images", () => {
  expect(prepareBoardOptions({ Black: "a" }, ["Black", "Brass"])).toEqual([]);
  expect(prepareBoardOptions({ Black: "a", Brass: "a" }, ["Black", "Brass"])).toEqual([]);
});
it("keeps size options distinct from color and rejects a missing size image", () => {
  const sizes = `<button data-parent-id="size" data-text="Small"><img src="https://cdn.example.com/small.jpg"></button><button data-parent-id="size" data-text="Large"><img src="https://cdn.example.com/large.jpg"></button>`;
  expect(publishedImageOptions(sizes)).toMatchObject({ kind: "size", options: [{ label: "Small" }, { label: "Large" }] });
  expect(publishedImageOptions(sizes + `<button data-parent-id="size" data-text="Medium"></button>`)).toBeNull();
});
it("uses structured retailer variant images only for the exact linked product and a complete option set", () => {
  const product = { url: "https://retailer.example/products/knob", variants: [
    { values: { Finish: "Black" }, images: [{ url: "https://cdn.example.com/black.jpg" }] },
    { values: { Finish: "Brass" }, images: [{ url: "https://cdn.example.com/brass.jpg" }] },
  ] };
  expect(structuredImageOptions(product, product.url)).toMatchObject({ kind: "finish", options: [{ label: "Black" }, { label: "Brass" }] });
  expect(structuredImageOptions(product, "https://retailer.example/products/different")).toBeNull();
  expect(structuredImageOptions({ ...product, variants: [...product.variants, { values: { Finish: "Nickel" }, images: [] }] }, product.url)).toBeNull();
});
it("compares complete color-and-size variants without mixing the size into the color", () => {
  const product = { url: "https://retailer.example/products/sconce", variants: [
    { id: "one", values: { color: "Iron", size: "Small" }, images: [{ url: "https://cdn.example.com/is.jpg" }] },
    { id: "two", values: { color: "Brass", size: "Small" }, images: [{ url: "https://cdn.example.com/bs.jpg" }] },
    { id: "three", values: { color: "Iron", size: "Large" }, images: [{ url: "https://cdn.example.com/il.jpg" }] },
    { id: "four", values: { color: "Brass", size: "Large" }, images: [{ url: "https://cdn.example.com/bl.jpg" }] },
  ] };
  const options = structuredImageOptions(product, product.url)!;
  expect(options.kind).toBe("variant");
  expect(cleanBoardOptionMatch({ status: "matched", option_index: 2, confidence: 0.99, reason: "Clear match" }, options.options, "board", product.url, options.kind))
    .toMatchObject({ option: "Iron / Large", attributes: { color: "Iron", size: "Large" }, variantId: "three" });
});
it("reports retailer access blocking rather than presenting it as a product option", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { html: "Sorry, due to website restrictions we are unable to display the requested page." } })));
  const result = await (await matchBoardOption(request())).json();
  expect(result.status).toBe("unavailable"); expect(result.reason).toContain("blocked"); expect(state.model).not.toHaveBeenCalled();
  expect(state.reserve).toHaveBeenCalledTimes(1); expect(state.reserve.mock.calls[0][3]).toMatchObject({ openAiCents: 0, firecrawlCredits: 1 });
});
it("does not contact Firecrawl if the run or its reservation is unavailable", async () => {
  delete state.access.body.full_check_run_id;
  expect((await matchBoardOption(request())).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  state.access.body.full_check_run_id = "33333333-3333-4333-8333-333333333333";
  state.reserve.mockResolvedValue(false);
  expect((await matchBoardOption(request())).status).toBe(409); expect(fetch).not.toHaveBeenCalled();
});
it("does not contact paid providers when the board image cannot be frozen safely", async () => {
  state.freeze.mockRejectedValueOnce(Error("unsafe image"));
  const result = await (await matchBoardOption(request())).json();
  expect(result.reason).toMatch(/safely downloaded/); expect(state.reserve).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(state.model).not.toHaveBeenCalled();
});
it("retains the scrape claim but does not generate an image comparison when the remaining budget is insufficient", async () => {
  state.reserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result = await (await matchBoardOption(request())).json();
  expect(result.status).toBe("unavailable"); expect(result.reason).toMatch(/already claimed/);
  expect(fetch).toHaveBeenCalledTimes(1); expect(state.reserve).toHaveBeenCalledTimes(2);
});
it("keeps a failed or lost retailer request pending so its budget cannot be reset", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("connection lost"); }));
  await expect(matchBoardOption(request())).rejects.toThrow("connection lost");
  expect(state.reserve).toHaveBeenCalledTimes(1); expect(state.settle).not.toHaveBeenCalled();
});
it("does not send the images if options cannot be identified", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { html: "<div>Product</div>" } })));
  const result = await (await matchBoardOption(request())).json();
  expect(result.status).toBe("unavailable"); expect(state.model).not.toHaveBeenCalled();
});
it("rejects an image comparison when the saved item changes during the request", async () => {
  state.model.mockImplementation(async () => { state.item.color = "Changed"; return Response.json({ status: "completed", output_text: "{}" }); });
  expect((await matchBoardOption(request())).status).toBe(409);
});
it("checks project access before reading images", async () => {
  state.access = Response.json({ error: "Forbidden" }, { status: 403 });
  expect((await matchBoardOption(request())).status).toBe(403);
  expect(state.model).not.toHaveBeenCalled();
});
it("returns an existing cached comparison without contacting either paid provider", async () => {
  state.access.user.email = "other@meravinteriors.com"; state.access.profile.email = "other@meravinteriors.com";
  state.access.body.action = "cached";
  state.cached = { status: "matched", option: "Brass", reason: "Saved", options: [], boardImage: "", productUrl: "", optionKind: "finish" };
  const result = await (await matchBoardOption(request())).json();
  expect(result.option).toBe("Brass"); expect(state.model).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("rejects paid comparisons from any other account, including a forged Ken profile", async () => {
  for (const [authEmail, profileEmail] of [["other@meravinteriors.com", "other@meravinteriors.com"], ["other@meravinteriors.com", "ken@meravinteriors.com"]]) {
    state.access.user.email = authEmail; state.access.profile.email = profileEmail;
    expect((await matchBoardOption(request())).status).toBe(403);
  }
  expect(fetch).not.toHaveBeenCalled(); expect(state.model).not.toHaveBeenCalled();
});
it("reuses cached warnings and selected variants even when image matching was unavailable", () => {
  const unavailable = { status: "unavailable" as const, option: "", reason: "No current saved image comparison", options: [], boardImage: "", productUrl: "", optionKind: "variant" as const };
  expect(reusableBoardOptionMatch(unavailable)).toBe(false);
  expect(reusableBoardOptionMatch({ ...unavailable, warnings: [{ message: "Not suitable", evidence: "Not suitable for bathroom use", sourceUrl: "https://example.com/product" }] })).toBe(true);
  expect(reusableBoardOptionMatch({ ...unavailable, linkedVariant: { sourceUrl: "https://example.com/product", variantId: "1", attributes: { finish: "Brass" } } })).toBe(true);
  expect(reusableBoardOptionMatch({ ...unavailable, status: "matched" })).toBe(true);
  expect(reusableBoardOptionMatch({ ...unavailable, status: "uncertain" })).toBe(true);
});
it("checks eligible project selections in order, retains failures and stops without retrying paid requests", async () => {
  const items = boardOptionBatchCandidates([
    { id: "a", image_url: "https://cdn.example.com/a", product_url: "https://shop.example/a" },
    { id: "b", source_board_element_id: "b", product_url: "https://shop.example/b" },
    { id: "no-link", image_url: "https://cdn.example.com/c" },
    { id: "c", source_board_element_id: "c", product_url: "https://shop.example/c" },
  ]);
  const calls: string[] = [], output: string[] = [];
  const summary = await runBoardOptionBatch(items, async item => {
    calls.push(item.id);
    if (item.id === "b") throw Error("Retailer unavailable");
    return cleanBoardOptionMatch({ status: "uncertain" }, [], "", "");
  }, (item, result, error) => output.push(`${item.id}:${result?.status || error}`), () => calls.length >= 2);
  expect(calls).toEqual(["a", "b"]);
  expect(output).toEqual(["a:uncertain", "b:Retailer unavailable"]);
  expect(summary).toEqual({ attempted: 2, stopped: true });
});
