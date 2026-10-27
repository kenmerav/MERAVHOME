import { isKnownPrice, moneyValue } from "./money";

type PriceSelection = {
  projectId: string;
  roomId: string;
  materialId: string;
  sourceId: string;
  selectionVersion: number;
  previousPrice: number | null;
};

/** Save a price in the same decision record that the Spec Book displays. */
export async function saveDesignAccuracyPrice(selection: PriceSelection, price: string | null, token: string) {
  if (!token) throw new Error("Sign in again before changing this Room Design price.");
  if (price !== null && !isKnownPrice(price)) throw new Error("Enter a valid client price.");
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
    (item.fields?.price?.value ?? null) !== selection.previousPrice) {
    throw new Error("This selection changed. Refresh Procurement before editing its price.");
  }
  const value = price === null ? null : moneyValue(price);
  if (value === selection.previousPrice) return;
  await request({ expectedRevision: state.revision, commands: [{
    type: "field", roomId: selection.roomId, itemId: selection.sourceId, key: "price", value,
  }] });
}
