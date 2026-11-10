import { expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { refreshMaterialProductInfo } from "@/lib/materialProductRefresh";

const project = "2b31849c-b94a-4b78-9bf0-e263bbfce6a0";
const a = "89863790-1b55-4a90-a9fe-0ec3a11f0b0d", b = "64f674d2-01d1-45bc-8fe5-8c6a24e66c9c";
const runId = "ed93b4a8-653a-4ba9-9b33-047873d6e353";

it("keeps saved products and reports unrefreshed items when the check budget is exhausted", async () => {
  let starts = 0;
  const request = vi.fn(async (_path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (init.method === "PUT") return Response.json({ ok: true, price_missing_count: 0 });
    expect(body.full_check_run_id).toBe(runId);
    if (++starts === 1) return Response.json({ status: "completed", remaining_count: 1,
      rows: [{ material_item_id: a, url: "https://vendor.test/a", scraped: { price: "$10" }, finish_check_token: "signed" }] });
    return Response.json({ code: "full_spec_budget_reached", error: "The $10 estimated check budget has been reached." }, { status: 409 });
  });
  const result = await refreshMaterialProductInfo(project, [a, b], { request, fullCheckRunId: runId, verifySelectedFinishes: true });
  expect(result).toMatchObject({ saved: 1, failed: 0, budgetStopped: true, notRefreshed: 1, finishChecks: ["signed"] });
  expect(request).toHaveBeenCalledTimes(3);
});

it("does not mistake other failures for a completed partial review", async () => {
  const request = vi.fn(async () => Response.json({ error: "Selection changed" }, { status: 409 }));
  await expect(refreshMaterialProductInfo(project, [a], { request, fullCheckRunId: runId, verifySelectedFinishes: true })).rejects.toThrow("Selection changed");
});
