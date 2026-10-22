import { afterEach, expect, it, vi } from "vitest";
import {
  ambiguousFinish,
  finishEvidenceFromPage,
  mergeFinishEvidence,
  reviewSelectedFinishes,
  shopifyFinishEvidence,
  type FinishObservation,
} from "../src/lib/selectedFinish";
import { readFinishObservations, signFinishObservation } from "../src/lib/selectedFinish.server";
import { checkSpecDetails } from "../src/lib/specCompletion";
import { completionDetailValue } from "../src/lib/specCompletionDetail";

const url = "https://vendor.test/products/faucet?variant=123";
const selection = (color: string) =>
  ({
    id: "item",
    room_id: "bath",
    item_label: "Faucet",
    color,
    quantity: 1,
    product_id: "product",
    product_url: url,
    product: { finish: "", price: "$100", price_unit: "unit" },
  }) as any;
const observation = (color: string): FinishObservation => ({
  item_id: "item",
  source_url: url,
  status: "verified",
  color,
  finish: "",
  basis: "url_variant",
  evidence: `URL variant 123: ${color}`,
  checked_at: new Date().toISOString(),
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it.each([
  "Bronze or Black",
  "either black or bronze",
  "Black and/or Brass",
  "Bronze?",
  "finish options: bronze, black",
])("flags unresolved alternatives: %s", (color) => {
  expect(ambiguousFinish(color)).toBe(true);
  const item = selection(color);
  expect(
    checkSpecDetails([item], [{ id: "bath", name: "Bath" }]).some((f) => f.field === "color"),
  ).toBe(true);
  const result = reviewSelectedFinishes([item], [observation("Bronze")]);
  expect(result.findings[0]).toMatchObject({
    finish_check: "ambiguous",
    current: color,
    suggested: "Bronze",
  });
  expect(item.color).toBe(color);
  expect(() => completionDetailValue("color", { value: color })).toThrow("confirmed");
});

it.each(["Black with brass accents", "Brass & Black", "Black / Brass", "two-tone black and brass"])(
  "allows an actual linked two-tone finish: %s",
  (color) => {
    expect(ambiguousFinish(color)).toBe(false);
    expect(
      reviewSelectedFinishes([selection(color)], [observation("Black / Brass")]),
    ).toMatchObject({ verified_count: 1, findings: [] });
    expect(completionDetailValue("color", { value: color })).toEqual({ color });
  },
);

it("flags a mismatch and does not silently change the saved selection", () => {
  const item = selection("Black");
  expect(reviewSelectedFinishes([item], [observation("Bronze")]).findings[0]).toMatchObject({
    finish_check: "mismatch",
    suggested: "Bronze",
  });
  expect(item.color).toBe("Black");
});
it("does not verify a default swatch or evidence for a different link", () => {
  expect(reviewSelectedFinishes([selection("Bronze")], []).findings[0].finish_check).toBe(
    "unverified",
  );
  const item = { ...selection("Bronze"), product_url: url.replace("123", "456") };
  expect(reviewSelectedFinishes([item], [observation("Bronze")]).findings[0]).toMatchObject({
    finish_check: "unverified",
    suggested: "",
  });
});
it("does not count a sheen alone as a verified color", () => {
  expect(reviewSelectedFinishes([selection("Matte")], [observation("Matte")]).findings[0].finish_check).toBe("unverified");
});

const shopify = {
  options: ["Color", "Size"],
  variants: [
    { id: "123", options: ["Bronze", "Small"] },
    { id: "456", options: ["Black", "Small"] },
  ],
};
it("reads the exact linked Shopify option and refuses an unselected or invalid variant", () => {
  expect(shopifyFinishEvidence(shopify, "123")).toMatchObject({
    status: "verified",
    color: "Bronze",
    basis: "url_variant",
  });
  expect(shopifyFinishEvidence(shopify, null).status).toBe("unverified");
  expect(shopifyFinishEvidence(shopify, "999").status).toBe("unverified");
});
it("allows one finish across multiple sizes without choosing a size", () => {
  expect(
    shopifyFinishEvidence(
      {
        ...shopify,
        variants: [
          { id: "123", options: ["Black & Brass", "Small"] },
          { id: "456", options: ["Black & Brass", "Large"] },
        ],
      },
      null,
    ),
  ).toMatchObject({ status: "verified", color: "Black & Brass", basis: "single_finish" });
});

const page = {
  markdown: "SKU 123 — Finish: Bronze",
  json: {
    selected_finish: "Bronze",
    selected_finish_basis: "url_variant",
    selected_variant_id: "123",
    selected_finish_evidence: "SKU 123 — Finish: Bronze",
  },
};
it("requires the selected variant and exact quoted finish evidence from the page", () => {
  expect(finishEvidenceFromPage(page, url)).toMatchObject({ status: "verified", finish: "Bronze" });
  expect(finishEvidenceFromPage(page, url.replace("123", "456")).status).toBe("unverified");
  expect(
    finishEvidenceFromPage({ ...page, markdown: "Available in Bronze or Black" }, url).status,
  ).toBe("unverified");
  expect(
    finishEvidenceFromPage(
      { ...page, json: { ...page.json, selected_finish: "Bronze or Black" } },
      url,
    ).status,
  ).toBe("unverified");
  expect(
    finishEvidenceFromPage(page, "https://vendor.test/products/faucet?utm_campaign=123").status,
  ).toBe("unverified");
});
it("requires one published finish for a single-finish claim and permits an actual two-tone option", () => {
  const value = {
    markdown: "Finish: Black & Brass",
    json: {
      selected_finish: "Black & Brass",
      selected_finish_basis: "single_finish",
      selected_finish_evidence: "Finish: Black & Brass",
      finish_options: ["Black & Brass"],
    },
  };
  expect(finishEvidenceFromPage(value, url).status).toBe("verified");
  expect(
    finishEvidenceFromPage(
      { ...value, json: { ...value.json, finish_options: ["Black & Brass", "Bronze"] } },
      url,
    ).status,
  ).toBe("unverified");
});
it("flags contradictory retailer sources instead of picking one", () => {
  expect(mergeFinishEvidence(observation("Bronze"), observation("Black"))?.status).toBe(
    "unverified",
  );
});

it("only accepts server-signed evidence for this project and rejects altered or expired results", () => {
  const secret = "test-only-signing-secret";
  const token = signFinishObservation("project", "item", url, observation("Bronze"), secret)!;
  expect(readFinishObservations([token], "project", secret)).toHaveLength(1);
  expect(readFinishObservations([token], "other-project", secret)).toEqual([]);
  const [payload, signature] = token.split(".");
  const forged = JSON.parse(Buffer.from(payload, "base64url").toString());
  forged.observation.color = "Black";
  expect(
    readFinishObservations(
      [`${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`],
      "project",
      secret,
    ),
  ).toEqual([]);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 25 * 3600_000);
  expect(readFinishObservations([token], "project", secret)).toEqual([]);
});
