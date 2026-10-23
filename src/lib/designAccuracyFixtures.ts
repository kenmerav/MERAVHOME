import { createAccuracyState, type AccuracyState } from "./designAccuracy";

export const ACCURACY_FIXTURE_ID = "local-design-accuracy";
export function accuracyFixture(): AccuracyState {
  const state = createAccuracyState(
    ACCURACY_FIXTURE_ID,
    [
      { id: "kitchen", name: "Kitchen" },
      { id: "bath", name: "Primary Bathroom" },
    ],
    "Local test designer",
    "2026-10-23T17:00:00Z",
  );
  // Deliberately unresolved. No invented historic confirmations or successful drawing checks.
  const examples: Record<string, Record<string, string | number | null>> = {
    "Kitchen:Faucet": {
      productName: "Bridge faucet",
      manufacturer: "Fixture supplier",
      sku: "BR-BZ",
      color: "Bronze or black",
      quantity: null,
      quantityUnit: "each",
      location: "Island",
      url: "https://example.com/faucet?finish=bronze",
    },
    "Kitchen:Cabinet finish": {
      manufacturer: "Cabinet manufacturer",
      color: "Natural oak",
      finishCodeOrSample: "Sample K-04",
      location: "Perimeter",
    },
    "Kitchen:Cabinet hardware": {
      productName: "6-inch pull",
      manufacturer: "Hardware supplier",
      sku: "P-6",
      color: "Bronze",
      mountingCenters: "4 inches",
      quantity: 1,
      quantityUnit: "each",
      quantityBasis: "Unconfirmed suggestion",
    },
    "Primary Bathroom:Faucet(s)": {
      productName: "Widespread faucet",
      manufacturer: "Fixture supplier",
      sku: "WF-BK",
      color: "Black",
      quantity: 2,
      quantityUnit: "each",
      location: "Vanity A",
    },
  };
  for (const room of state.rooms)
    for (const item of room.items) {
      const values = examples[`${room.name}:${item.category}`];
      if (values)
        for (const [key, value] of Object.entries(values))
          item.fields[key] = { value, history: [] };
    }
  return state;
}
