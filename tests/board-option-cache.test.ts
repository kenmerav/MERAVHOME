import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: { report: { untouched: "keep" } as any, updated_at: "2026-01-01T00:00:00.000Z" } }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => {
  let patch: any = null; const filters: Record<string, unknown> = {};
  const q: any = { select: () => q, update: (value: any) => { patch = value; return q; }, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
    maybeSingle: async () => { if (patch && filters.updated_at !== state.row.updated_at) return { data: null, error: null };
      if (patch) { state.row = { ...state.row, ...patch }; return { data: { project_id: "project" }, error: null }; }
      return { data: structuredClone(state.row), error: null }; } }; return q;
} } }));
import { boardOptionSignature, readBoardOptionCache, saveBoardOptionCache } from "@/lib/boardOptionCache.server";
beforeEach(() => { state.row = { report: { untouched: "keep" }, updated_at: "2026-01-01T00:00:00.000Z" }; });
it("preserves other review data and invalidates a cached comparison when its source changes", async () => {
  const item = { id: "item", room_id: "room", product_id: "product", product_url: "https://shop.example/a", product: { sku: "A", finish: "Brass" }, color: "Brass" };
  const source = { image_url: "https://cdn.example.com/board.jpg" };
  const signature = boardOptionSignature(item, source);
  const value: any = { status: "matched", option: "Brass", reason: "match", options: [], boardImage: source.image_url, productUrl: item.product_url, optionKind: "finish" };
  expect(await saveBoardOptionCache("project", item.id, signature, value)).toBe(true);
  expect(state.row.report.untouched).toBe("keep");
  expect(await readBoardOptionCache("project", item.id, signature)).toEqual(value);
  expect(await readBoardOptionCache("project", item.id, boardOptionSignature({ ...item, product_url: "https://shop.example/b" }, source))).toBeNull();
});
