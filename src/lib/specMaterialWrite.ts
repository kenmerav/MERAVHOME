// The database response must confirm a row was updated before the UI reports success.
export function requireSavedSpecMaterial(result: {
  data: { id: string } | null;
  error: { message?: string } | null;
}) {
  if (result.error) throw new Error(result.error.message || "Could not save the material item.");
  if (!result.data) throw new Error("The material item could not be updated. Refresh and try again.");
  return result.data;
}
