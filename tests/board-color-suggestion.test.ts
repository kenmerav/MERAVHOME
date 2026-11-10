import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { MaterialItem } from "@/lib/db";
import { linkedBoardImage, cleanBoardColorSuggestion } from "@/lib/boardColorSuggestion";
const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const itemId = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
const state = vi.hoisted(() => ({ item: null as any, board: null as any, access: null as any, fetch: vi.fn(), count: vi.fn(), freeze: vi.fn(), reserve: vi.fn(), settle: vi.fn(), budget: vi.fn() }));
vi.mock("@/lib/specCompletion.server", () => ({ authorizeCompletionProject: async () => state.access }));
vi.mock("@/lib/fullSpecBudget.server", () => ({ assertProductionFullSpecBudget: state.budget, productionFullSpecBudgetStore: () => ({}) }));
vi.mock("@/lib/fullSpecBudgetStore", () => ({ reserveFullSpecBudget: state.reserve, settleFullSpecBudget: state.settle }));
vi.mock("@/lib/immutableSpecImages.server", () => ({ immutableSpecImages: state.freeze }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (table: string) => {
    const filters: any = {};
    const q: any = { select: () => q, eq: (key: string, value: string) => { filters[key] = value; return q; },
      maybeSingle: async () => ({ data: filters.project_id !== projectId ? null : table === "design_boards" ?
        { board_state: state.board } : filters.id === itemId ? state.item : null, error: null }) };
    return q;
  },
} }));
import { suggestBoardColor, boardColorImageUrl } from "@/lib/boardColorSuggestion.server";
const request = () => new Request("https://studio.test/api/suggest-board-color", { method: "POST", body: "{}" });
beforeEach(() => {
  vi.clearAllMocks(); state.access = { projectId, userId: "staff", body: { item_id: itemId, full_check_run_id: "44444444-4444-4444-8444-444444444444" }, user: { email: "ken@meravinteriors.com" }, profile: { email: "ken@meravinteriors.com", is_active: true, role: "Admin" } };
  state.reserve.mockResolvedValue(true); state.budget.mockResolvedValue({});
  state.freeze.mockResolvedValue({ images: ["data:image/png;base64,dGVzdA=="], bytes: 4 });
  state.item = { id: itemId, project_id: projectId, room_id: "bath", item_label: "Tile", color: null, not_needed: false,
    product_id: "product", product: { name: "Selected tile", finish: null },
    source_board_id: projectId, source_board_page_id: "page", source_board_element_id: "element" };
  state.board = { pages: [{ id: "page", title: "Guest Bath", elements: [{ id: "element", type: "image", src: "https://cdn.example.com/tile.jpg",
    productId: "product", materialItemId: itemId, materialRoomId: "bath", imageBrightness: 100, imageContrast: 100, imageSaturation: 100, imageWarmth: 0 }] }] };
  state.fetch.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify({ status: "suggested", color: "Warm beige", confidence: 0.9,
    reason: "The selected tile has a clear warm beige base." }) }));
  vi.stubGlobal("fetch", (url: string, options: unknown) => url.endsWith("/input_tokens") ?
    (state.count(url, options), Promise.resolve(Response.json({ input_tokens: 3500 }))) : state.fetch(url, options));
  vi.stubEnv("OPENAI_API_KEY", "TEST_ONLY_KEY");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses the current linked board image and returns a visual suggestion without saving a color", async () => {
  const result = await (await suggestBoardColor(request())).json();
  expect(result).toMatchObject({ status: "suggested", color: "Warm beige", source: { page_id: "page", page_name: "Guest Bath" } });
  expect(state.item.color).toBeNull();
  const body = JSON.parse(state.fetch.mock.calls[0][1].body);
  expect(body.store).toBe(false); expect(body.input[0].content[1].image_url).toBe("data:image/png;base64,dGVzdA==");
  expect(JSON.parse(state.count.mock.calls[0][1].body).input[0].content[1].image_url).toBe(body.input[0].content[1].image_url);
  expect(body).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "high" }, service_tier: "default", max_output_tokens: 8000 });
  expect(body.instructions).toContain("Never invent a manufacturer color name");
});
it("does not overwrite or analyze an existing color or finish", async () => {
  state.item.color = "White"; expect((await suggestBoardColor(request())).status).toBe(409);
  state.item.color = null; state.item.product.finish = "Matte Black";
  expect((await suggestBoardColor(request())).status).toBe(409);
  expect(state.fetch).not.toHaveBeenCalled();
});
it("can suggest missing color when only a sheen was entered", async () => {
  state.item.product.finish = "Matte";
  const result = await (await suggestBoardColor(request())).json();
  expect(result.status).toBe("suggested"); expect(state.item.color).toBeNull();
  expect(state.item.product.finish).toBe("Matte");
});
it("uses the shared project access guard and rejects other-project materials", async () => {
  state.access = Response.json({ error: "Forbidden" }, { status: 403 });
  expect((await suggestBoardColor(request())).status).toBe(403);
  state.access = { ...state.access, projectId: itemId, body: { item_id: itemId, full_check_run_id: "44444444-4444-4444-8444-444444444444" }, user: { email: "ken@meravinteriors.com" }, profile: { email: "ken@meravinteriors.com", is_active: true, role: "Admin" } };
  expect((await suggestBoardColor(request())).status).toBe(404);
  expect(state.fetch).not.toHaveBeenCalled();
});
it("requires Ken's active run and reserves before generating a color suggestion", async () => {
  state.access.body.full_check_run_id = "";
  expect((await suggestBoardColor(request())).status).toBe(400); expect(state.fetch).not.toHaveBeenCalled();
  state.access.body.full_check_run_id = "44444444-4444-4444-8444-444444444444";
  state.access.user.email = "other@meravinteriors.com";
  expect((await suggestBoardColor(request())).status).toBe(403); expect(state.fetch).not.toHaveBeenCalled();
  state.access.user.email = "ken@meravinteriors.com"; state.reserve.mockResolvedValue(false);
  const result = await (await suggestBoardColor(request())).json();
  expect(result.status).toBe("unavailable"); expect(result.reason).toContain("already attempted"); expect(state.fetch).not.toHaveBeenCalled();
});
it("does not analyze unrelated, excluded or removed board pictures", async () => {
  const element = state.board.pages[0].elements[0];
  element.id = "other"; element.materialItemId = "other";
  expect((await (await suggestBoardColor(request())).json()).status).toBe("unavailable");
  element.id = "element"; element.materialItemId = itemId; element.materialExcludeFromMaterials = true;
  expect(linkedBoardImage(state.item, state.board)).toBeNull();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("requires exact item identity rather than a similar label or another product/room", () => {
  const element = state.board.pages[0].elements[0];
  element.productId = "different-product"; expect(linkedBoardImage(state.item, state.board)).toBeNull();
  element.productId = "product"; element.materialRoomId = "other-room";
  expect(linkedBoardImage(state.item, state.board)).toBeNull();
});
it("accepts repeated identical pictures but rejects conflicting variants and color-adjusted images", () => {
  const element = state.board.pages[0].elements[0];
  state.board.pages[0].elements.push({ ...element, id: "copy" });
  expect(linkedBoardImage(state.item, state.board)?.image_url).toBe(element.src);
  state.board.pages[0].elements[1].src = "https://cdn.example.com/black.jpg";
  expect(linkedBoardImage(state.item, state.board)).toBeNull();
  state.board.pages[0].elements.pop(); element.imageWarmth = 20;
  expect(linkedBoardImage(state.item, state.board)).toBeNull();
});
it("rejects an unsynced product link variant", () => {
  state.item.product_url = "https://retailer.example.com/tile?variant=white";
  state.board.pages[0].elements[0].link = "https://retailer.example.com/tile?variant=black";
  expect(linkedBoardImage(state.item, state.board)).toBeNull();
});
it.each([0.2, 0.79, NaN, "0.99"])("does not suggest a color for uncertain confidence %s", confidence => {
  const result = cleanBoardColorSuggestion({ status: "suggested", color: "Warm beige", confidence, reason: "Unclear lighting" }, linkedBoardImage(state.item, state.board)!);
  expect(result.status).toBe("uncertain"); expect(result.color).toBe("");
});
it("keeps the field unconfirmed when credits are unavailable or inference is incomplete", async () => {
  state.fetch.mockResolvedValue(Response.json({ error: { code: "credit_balance_exhausted" } }, { status: 429 }));
  let result = await (await suggestBoardColor(request())).json(); expect(result.reason).toContain("need AI credits");
  expect(result.color).toBe(""); expect(result.status).toBe("unavailable");
  state.fetch.mockResolvedValue(Response.json({ status: "incomplete", output_text: "{}" }));
  result = await (await suggestBoardColor(request())).json(); expect(result.status).toBe("unavailable");
});
it("rejects a suggestion if the image or missing-color field changed during the scan", async () => {
  state.fetch.mockImplementation(async () => { state.board.pages[0].elements[0].src = "https://cdn.example.com/new.jpg";
    return Response.json({ status: "completed", output_text: JSON.stringify({ status: "suggested", color: "Warm beige", confidence: 0.9, reason: "Visible tile" }) }); });
  expect((await suggestBoardColor(request())).status).toBe(409);
});
it.each(["http://cdn.example.com/tile.jpg", "https://127.0.0.1/tile", "https://[::1]/tile", "https://user:secret@cdn.example.com/tile",
  "https://example.supabase.co/storage/v1/object/sign/private/tile?token=private", "https://cdn.example.com/image?api_key=secret"])(
  "never forwards credential-bearing or local image URLs %s", value => {
    expect(() => boardColorImageUrl(value)).toThrow();
  });
