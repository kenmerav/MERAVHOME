import { expect, it } from "vitest";
import { normalizeFirecrawlProduct, shopifySizeDetails } from "@/lib/firecrawlProduct";
import { completionSolution, completionProductLink } from "@/lib/specCompletionPresentation";
import type { CompletionFinding } from "@/lib/specCompletion";
const url = "https://shop.test/mirror";
it("extracts measurements and published choices for an exact selected variant", () => {
  const value = normalizeFirecrawlProduct({ json: { dimensions: '24 in W x 36 in H',
    size_options: ['24 x 36 in', '30 x 36 in'], selected_size: '24 x 36 in' } }, url);
  expect(value.dimensions).toBe('24 in W x 36 in H');
  expect(value.size_options).toHaveLength(2); expect(value.selected_size).toBe('24 x 36 in');
});
it("keeps an unselected multi-size product unresolved rather than selecting default measurements", () => {
  const value = normalizeFirecrawlProduct({ json: { dimensions: '30 x 36 in', size_options: ['24 x 36 in', '30 x 36 in'] } }, url);
  expect(value.dimensions).toBe(""); expect(value.selected_size).toBe("");
});
it("accepts a published single-size dimension and never promotes a named size to measurements", () => {
  expect(normalizeFirecrawlProduct({ json: { dimensions: '24 x 36 in' } }, url).dimensions).toBe('24 x 36 in');
  expect(normalizeFirecrawlProduct({ json: { selected_size: 'Large', size_options: ['Small', 'Large'] } }, url).dimensions).toBe("");
  expect(normalizeFirecrawlProduct({ json: { selected_size: '24 in', size_options: ['24 in', '30 in'] } }, url).dimensions).toBe('24 in');
});
it("deduplicates published choices and ignores malformed option data", () => {
  expect(normalizeFirecrawlProduct({ json: { size_options: ['24 in', ' 24 IN ', null, 1, 'TBD'] } }, url).size_options).toEqual(['24 IN']);
});
it("reads Shopify's exact selected size and never chooses an arbitrary default", () => {
  const product = { options: ['Color', { name: 'Size' }], variants: [
    { id: 1, options: ['Brass', '24 x 36 in'] }, { id: 2, options: ['Black', '30 x 36 in'] },
    { id: 3, options: ['Black', '24 x 36 in'] } ] };
  expect(shopifySizeDetails(product, '2')).toEqual({ dimensions: '30 x 36 in', selected_size: '30 x 36 in', size_options: ['24 x 36 in', '30 x 36 in'] });
  expect(shopifySizeDetails(product, null).dimensions).toBe('');
  expect(shopifySizeDetails(product, 'unknown').selected_size).toBe('');
  expect(shopifySizeDetails({ options: ['Finish'], variants: [{ id: 1, options: ['Brass'] }] }, '1').size_options).toEqual([]);
});
const finding = { field: 'quantity', source: 'plans', current: '1', suggested: '2 count' } as CompletionFinding;
it("gives an actionable recommendation without applying a plan suggestion", () => {
  expect(completionSolution(finding)).toContain('from 1 to 2 count');
  expect(completionSolution({ ...finding, field: 'dimensions', suggested: '30 in W', dimension_scope: 'proposed_layout' })).toContain('planned in the drawings');
  expect(completionSolution({ ...finding, field: 'price', source: 'details' })).toContain('supplier quote');
});
it("uses a saved color suggestion in the solution while requiring manufacturer verification", () => {
  expect(completionSolution({ ...finding, field: 'color', source: 'details' }, undefined,
    { kind: 'color', value: { status: 'suggested', color: 'Warm beige', confidence: .9, reason: 'Visible color', source: null } }))
    .toContain('Warm beige. Verify the exact manufacturer color');
});
it("only renders ordinary product links", () => {
  expect(completionProductLink('javascript:alert(1)')).toBeNull();
  expect(completionProductLink('broken')).toBeNull(); expect(completionProductLink(url)).toBe(url);
});
