import { afterEach, describe, expect, it, vi } from "vitest";
import { saveDesignAccuracyPrice } from "@/lib/designAccuracyPricing";

const selection = { projectId: "project", roomId: "room", materialId: "material", sourceId: "selection", selectionVersion: 4, previousPrice: 80 };
function state() {
  return { projectId: "project", revision: 9, rooms: [{ id: "room", items: [{ id: "selection", materialId: "material", version: 4, fields: { price: { value: 80 } } }] }] };
}
function fetchWithState(data: ReturnType<typeof state>) {
  return vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: data }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
}
afterEach(() => vi.unstubAllGlobals());

describe("syncing Procurement price to the Spec Book", () => {
  it("updates the linked Room Design price using its current revision", async () => {
    const fetchMock = fetchWithState(state());
    vi.stubGlobal("fetch", fetchMock);
    await saveDesignAccuracyPrice(selection, "$125.50", "token");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expectedRevision: 9, commands: [
      { type: "field", roomId: "room", itemId: "selection", key: "price", value: 125.5 },
    ] });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer token");
  });

  it("allows an intentional clear and does not write when the price is unchanged", async () => {
    const fetchMock = fetchWithState(state());
    vi.stubGlobal("fetch", fetchMock);
    await saveDesignAccuracyPrice(selection, null, "token");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).commands[0].value).toBeNull();
    const same = fetchWithState(state());
    vi.stubGlobal("fetch", same);
    await saveDesignAccuracyPrice(selection, "$80.00", "token");
    expect(same).toHaveBeenCalledTimes(1);
  });

  it.each(["changed price", "changed version", "changed material"]) ("rejects a stale or different selection: %s", async (change) => {
    const current = state();
    if (change === "changed price") current.rooms[0].items[0].fields.price.value = 81;
    if (change === "changed version") current.rooms[0].items[0].version++;
    if (change === "changed material") current.rooms[0].items[0].materialId = "other";
    const fetchMock = fetchWithState(current);
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveDesignAccuracyPrice(selection, "$125", "token")).rejects.toThrow("Refresh Procurement");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a concurrent save conflict rather than overwriting it", async () => {
    const fetchMock = fetchWithState(state());
    fetchMock.mockReset().mockResolvedValueOnce({ ok: true, json: async () => ({ state: state() }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "A newer version is saved. Reload before confirming." }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveDesignAccuracyPrice(selection, "$125", "token")).rejects.toThrow("newer version");
  });
});
