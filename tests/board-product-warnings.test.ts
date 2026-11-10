import { expect, it } from "vitest";
import { bathroomProductWarnings } from "@/lib/boardProductWarnings";

const url = "https://www.crateandbarrel.com/biba-wall-sconce/s593297";
const bathroom = { client_product_name: "Bathroom 2 sconce" };
it("reports an explicit bathroom-use restriction from the linked page", () => {
  const page = { metadata: { sourceURL: url }, html: "<li>Not suitable for bathroom use</li>" };
  expect(bathroomProductWarnings(page, url, bathroom)).toMatchObject([{ sourceUrl: url, evidence: "Not suitable for bathroom use" }]);
});
it("does not infer a restriction for another room, another page, scripts, or a damp rating", () => {
  expect(bathroomProductWarnings({ html: "Not suitable for bathroom use" }, url, { room: "Kitchen" })).toEqual([]);
  expect(bathroomProductWarnings({ metadata: { sourceURL: "https://retailer.test/different" }, html: "Not suitable for bathroom use" }, url, bathroom)).toEqual([]);
  expect(bathroomProductWarnings({ html: "<script>Not suitable for bathroom use</script><p>Damp rated</p>" }, url, bathroom)).toEqual([]);
});
