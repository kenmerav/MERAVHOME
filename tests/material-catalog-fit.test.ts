import { expect, it } from "vitest";
import type { Product, MaterialItem } from "@/lib/db";
import {
  assessCatalogFit,
  cleanFitRequirements,
  roomCoordinationSources,
  type PublicCatalogPlanFit,
  type FitRequirement,
} from "@/lib/materialCatalogFit";
const product = (patch = {}) =>
  ({
    name: "Undermount Bathroom Sink",
    dimensions: "Width: 20 in; Depth: 16 in",
    finish: "White",
    ...patch,
  }) as Product;
const plan = (requirements: FitRequirement[] = []) =>
  ({
    status: "checked",
    document: { id: "doc", title: "Latest plans", updated_at: "v1" },
    requirements,
    message: "Checked",
  }) as PublicCatalogPlanFit;
const requirement = (patch = {}) =>
  ({
    label: "Sink",
    field: "width",
    value: 20,
    page: 4,
    sheet: "ID2.1",
    evidence: "Sink overall width 20 inches",
    ...patch,
  }) as FitRequirement;
const item = (patch = {}) =>
  ({
    id: "shower",
    product_id: "selected",
    item_label: "Shower System",
    color: "Polished Nickel",
    product: { name: "Shower trim", finish: "Polished Nickel" },
    ...patch,
  }) as MaterialItem;

it("matches the explicit sink width and mounting method without claiming all physical fit is confirmed", () => {
  expect(
    assessCatalogFit(
      product(),
      "Sink",
      [],
      plan([requirement(), requirement({ field: "mount", value: "undermount" })]),
    ).status,
  ).toBe("matches_recorded_requirements");
});
it("rejects a wall-mounted requirement when the catalog sink is undermount", () => {
  expect(
    assessCatalogFit(product(), "Sink", [], plan([requirement({ field: "mount", value: "wall" })]))
      .status,
  ).toBe("conflict");
});
it("does not use matching width to hide a depth conflict", () => {
  expect(
    assessCatalogFit(
      product(),
      "Sink",
      [],
      plan([requirement(), requirement({ field: "depth", value: 18 })]),
    ).status,
  ).toBe("conflict");
});
it("uses an explicitly labelled overall width even when internal bowl dimensions are also recorded", () => {
  expect(
    assessCatalogFit(
      product({ dimensions: "Basin Width: 16 in; Overall Width: 20 in" }),
      "Sink",
      [],
      plan([requirement()]),
    ).status,
  ).toBe("matches_recorded_requirements");
});
it("does not assume an installation tolerance for an oversized product", () => {
  expect(
    assessCatalogFit(
      product({ dimensions: "Overall Width: 20.125 in" }),
      "Sink",
      [],
      plan([requirement()]),
    ).status,
  ).toBe("conflict");
});
it("does not exclude the scheduled drain by treating its advertised size as overall body width", () => {
  const result = assessCatalogFit(
    product({ name: 'Delta 4" Tile-In Square Shower Drain', dimensions: 'Width: 4.5625 in', finish: 'Polished Nickel' }),
    'Shower Drain',
    [item()],
    plan([requirement({ label: 'Shower Drain', value: 4, evidence: 'Fixture schedule F5: DELTA 4-inch TILE-IN SQUARE SHOWER DRAIN; Bathroom 2.' })]),
  );
  expect(result.status).toBe('needs_review');
  expect(result.finish_match).toBe(true);
  expect(result.notes.join(' ')).toContain('advertised size alone');
});
it("keeps a conflict when the fixture schedule explicitly specifies overall width", () => {
  expect(assessCatalogFit(
    product({dimensions:'Overall Width: 30 in'}), 'Sink', [],
    plan([requirement({evidence:'Fixture schedule F1: sink overall width 20 inches.'})]),
  ).status).toBe('conflict');
});
it("labels missing catalog measurements as unverified rather than inferring them from the product title", () => {
  const result = assessCatalogFit(
    product({ name: "20 inch sink", dimensions: null }),
    "Sink",
    [],
    plan([requirement()]),
  );
  expect(result.status).toBe("needs_review");
  expect(result.notes.join(" ")).toContain("not recorded");
});
it("checks a toilet's recorded rough-in instead of using general toilet dimensions", () => {
  const toilet = product({ name: "Toilet", dimensions: "Width: 18 in; Rough In: 12 in" });
  expect(
    assessCatalogFit(
      toilet,
      "Toilet",
      [],
      plan([requirement({ label: "Toilet", field: "rough_in", value: 10 })]),
    ).status,
  ).toBe("conflict");
});
it("prefers shower-system finish for a drain while explaining other mixed plumbing finishes", () => {
  const sources = [
    item(),
    item({
      id: "faucet",
      item_label: "Sink faucet",
      color: "Brushed Gold",
      product: { name: "Vanity faucet" },
    }),
  ];
  const drain = product({ name: "Round Shower Drain", finish: "Polished Nickel" });
  const result = assessCatalogFit(
    drain,
    "Shower Drain",
    sources,
    plan([requirement({ label: "Shower Drain", field: "drain_type", value: "point" })]),
  );
  expect(result.finish_match).toBe(true);
  expect(result.status).toBe("needs_review");
  expect(result.notes.join(" ")).toContain("mixed finishes");
  expect(result.notes.join(" ")).toContain("waterproofing");
});
it("does not let matching finish make a point drain fit a linear-drain requirement", () => {
  const result = assessCatalogFit(
    product({ name: "Round Shower Drain", finish: "Polished Nickel" }),
    "Shower Drain",
    [item()],
    plan([requirement({ label: "Shower Drain", field: "drain_type", value: "linear" })]),
  );
  expect(result.finish_match).toBe(true);
  expect(result.status).toBe("conflict");
});
it("does not inherit metal finish from toilets or basin color, or use excluded plumbing", () => {
  expect(
    roomCoordinationSources("Shower Drain", [
      item({ not_needed: true }),
      item({ item_label: "Toilet", product: { name: "White Toilet" }, color: "White" }),
      item({ item_label: "Sink", product: { name: "Vanity sink" }, color: "White" }),
    ]),
  ).toEqual([]);
  expect(roomCoordinationSources("Sink", [item()])).toEqual([]);
});
it("leaves fit unconfirmed when there is no document or no explicit item requirements", () => {
  expect(
    assessCatalogFit(product(), "Sink", [], {
      status: "no_document",
      document: null,
      requirements: [],
      message: "No plans",
    }).status,
  ).toBe("needs_review");
  expect(assessCatalogFit(product(), "Sink", [], plan()).status).toBe("needs_review");
});
const row = {
  label: "Sink",
  field: "width",
  value: 508,
  unit: "mm",
  page: 4,
  sheet: "ID2.1",
  evidence: "Overall basin width explicitly 508 mm",
  confidence: "high",
  explicit_specification: true,
  exact_object: true,
  inferred: false,
};
it("converts explicit units and requires exact room-object evidence", () => {
  expect(cleanFitRequirements([row], ["Sink"], 26)[0].value).toBe(20);
  for (const patch of [
    { exact_object: false },
    { inferred: true },
    { explicit_specification: false },
    { page: 27 },
    { evidence: "" },
    { confidence: "low" },
    { label: "Other room sink" },
    { unit: "unknown" },
  ])
    expect(cleanFitRequirements([{ ...row, ...patch }], ["Sink"], 26)).toEqual([]);
});
it("discards conflicting plan dimensions instead of silently selecting a drawing", () => {
  expect(cleanFitRequirements([row, { ...row, value: 762 }], ["Sink"], 26)).toEqual([]);
});
