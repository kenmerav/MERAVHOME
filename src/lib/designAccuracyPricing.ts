import { isKnownPrice, moneyValue } from "./money";

type PriceSelection = {
  projectId: string;
  roomId: string;
  materialId: string;
  sourceId: string;
  selectionVersion: number;
  previousPrice: number | null;
  previousPriceUnit?: string;
};

/** Save a price in the same decision record that the Spec Book displays. */
export async function saveDesignAccuracyPrice(selection: PriceSelection, price: string | null | undefined, token: string, priceUnit?: "unit" | "sq_ft" | null) {
  if (!token) throw new Error("Sign in again before changing this Room Design price.");
  if (price !== undefined && price !== null && !isKnownPrice(price)) throw new Error("Enter a valid client price.");
  const url = `/api/design-accuracy?projectId=${encodeURIComponent(selection.projectId)}`;
  const request = async (body?: unknown) => {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update the Room Design price.");
    return result;
  };
  const result = await request();
  const state = result.state;
  const item = state?.rooms?.find((room: { id: string }) => room.id === selection.roomId)
    ?.items?.find((entry: { id: string }) => entry.id === selection.sourceId);
  if (!Number.isInteger(state?.revision) || state.projectId !== selection.projectId ||
    !item || item.materialId !== selection.materialId || item.version !== selection.selectionVersion ||
    (item.fields?.price?.value ?? null) !== selection.previousPrice ||
    (priceUnit !== undefined && (item.fields?.priceUnit?.value || "") !== (selection.previousPriceUnit || ""))) {
    throw new Error("This selection changed. Refresh Procurement before editing its price.");
  }
  const commands: Array<{ type: "field"; roomId: string; itemId: string; key: string; value: string | number | null }> = [];
  if (price !== undefined) {
    const value = price === null ? null : moneyValue(price);
    if (value !== selection.previousPrice) commands.push({ type: "field", roomId: selection.roomId, itemId: selection.sourceId, key: "price", value });
  }
  if (priceUnit !== undefined) {
    const value = priceUnit === "sq_ft" ? "sq ft" : priceUnit === "unit" ? "each" : null;
    if (value !== (selection.previousPriceUnit || null)) commands.push({ type: "field", roomId: selection.roomId, itemId: selection.sourceId, key: "priceUnit", value });
  }
  if (!commands.length) return;
  await request({ expectedRevision: state.revision, commands });
}
