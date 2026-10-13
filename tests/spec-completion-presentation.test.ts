import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
vi.mock('@/lib/specCompletionClient', () => ({ fetchSpecCompletion: vi.fn(), fetchBoardColorSuggestion: vi.fn(),
  fetchPlanDimensionSuggestion: vi.fn(), fetchSavedSpecCompletion: vi.fn(), updateCompletionIssue: vi.fn(), saveCompletionDetail: vi.fn() }));
import { SpecCompletionResults } from '@/components/SpecCompletionReview';
import type { MaterialItem } from '@/lib/db';
import type { CompletionFinding } from '@/lib/specCompletion';
import { completionMaterialsLink } from '@/lib/specCompletionPresentation';
it('shows the saved document refresh result and time without implying guaranteed freshness', () => {
  const html = renderToStaticMarkup(createElement(SpecCompletionResults, { projectId: 'project', rooms: [], findings: [], itemCount: 0,
    document: null, message: 'Plans reviewed.', documentRefresh: { status: 'checked', uploaded: 1, checked_at: '2026-10-13T19:00:00Z',
      message: 'Email checked; unmatched PDFs need review, so the latest version cannot be guaranteed.' } }));
  expect(html).toContain('latest version cannot be guaranteed'); expect(html).toContain('Checked');
});
it('shows a prominent item title, exact item image, product link and actionable solution', () => {
  const html = renderToStaticMarkup(createElement(SpecCompletionResults, { projectId: 'project', rooms: [{ id: 'bath', name: 'Guest Bath' }],
    items: [{ id: 'mirror', room_id: 'bath', item_label: 'Mirror', image_url: 'https://cdn.test/selected.jpg',
      product: { name: 'Thin frame mirror', product_url: 'https://shop.test/mirror' } } as MaterialItem],
    findings: [{ id: 'missing-price', item_id: 'mirror', room_id: 'bath', item_label: 'Guest Bathroom Mirror',
      source: 'details', field: 'price', current: '', suggested: '', message: 'Price missing' } as CompletionFinding],
    itemCount: 1, document: null, message: 'Review ready' }));
  expect(html).toContain('text-xl sm:text-2xl font-semibold');
  expect(html).toContain('Guest Bathroom Mirror'); expect(html).toContain('src="https://cdn.test/selected.jpg"');
  expect(html).toContain('Thin frame mirror'); expect(html).toContain('href="https://shop.test/mirror"');
  expect(html).toContain('Suggested next step'); expect(html).toContain('supplier quote');
  expect(html).toContain('href="/projects/project/materials?itemId=mirror#materials-item-mirror"');
  expect(html).toContain('target="_blank"');
});

it('keeps missing-item findings linked to the correct room', () => {
  expect(completionMaterialsLink('project', 'guest-bath')).toBe('/projects/project/materials?roomId=guest-bath#materials-room-guest-bath');
});

it('puts the AI board check next to the color issue, ahead of unrelated price issues', () => {
  const findings = ['color', 'price'].map(field => ({ id: field, item_id: 'mirror', room_id: 'bath', item_label: 'Mirror',
    source: 'details', field, current: '', suggested: '', message: 'Needs confirmation' } as CompletionFinding));
  const issues = findings.map(finding => ({ key: finding.id, finding, status: 'open' as const, room_name: 'Bath', document: null,
    first_seen_at: 'now', last_seen_at: 'now', status_updated_at: null, status_updated_by: null }));
  const html = renderToStaticMarkup(createElement(SpecCompletionResults, { projectId: 'project', rooms: [{ id: 'bath', name: 'Bath' }],
    findings, issues, checkedAt: 'now', itemCount: 1, document: null, message: 'Review ready' }));
  expect(html).toContain('Check Design Board');
  expect(html).toContain('Suggest a likely color');
  expect(html.indexOf('Check Design Board')).toBeLessThan(html.indexOf('supplier quote'));
});

it('offers separate inline price and color saves only for open, current selections', () => {
  const item = { id: 'mirror', room_id: 'bath', project_id: 'project', product_id: 'product', item_label: 'Mirror', product: { id: 'product', price: null } } as MaterialItem;
  const findings = ['color', 'price'].map(field => ({ id: field, item_id: 'mirror', room_id: 'bath', item_label: 'Mirror',
    source: 'details', field, current: '', suggested: '', message: 'Needs confirmation' } as CompletionFinding));
  const issues = findings.map(finding => ({ key: finding.id, finding, status: 'open' as const, room_name: 'Bath', document: null,
    first_seen_at: 'now', last_seen_at: 'now', status_updated_at: null, status_updated_by: null }));
  const props = { projectId: 'project', rooms: [{ id: 'bath', name: 'Bath' }], items: [item], findings, issues, checkedAt: 'now',
    itemCount: 1, document: null, message: 'Review ready', onSaveDetail: vi.fn() };
  const html = renderToStaticMarkup(createElement(SpecCompletionResults, props));
  expect(html).toContain('Color / finish for Mirror'); expect(html).toContain('Price for Mirror');
  expect(html).toContain('Price basis for Mirror');
  expect(html.match(/Save &amp; complete/g)).toHaveLength(2);
  const unavailable = renderToStaticMarkup(createElement(SpecCompletionResults, { ...props, items: [] }));
  expect(unavailable).not.toContain('Save &amp; complete');
});
it('offers inline dimensions with an optional plan suggestion that still requires confirmation', () => {
  const finding = { id: 'size', item_id: 'mirror', room_id: 'bath', item_label: 'Mirror', source: 'plans', field: 'dimensions',
    current: '', suggested: '30" W × 36" H', dimension_scope: 'proposed_layout', page: 2, evidence: 'Mirror elevation labels the size.' } as CompletionFinding;
  const issue = { key: 'size', finding, status: 'open' as const, room_name: 'Bath', document: null,
    first_seen_at: 'now', last_seen_at: 'now', status_updated_at: null, status_updated_by: null };
  const html = renderToStaticMarkup(createElement(SpecCompletionResults, { projectId: 'project', rooms: [{ id: 'bath', name: 'Bath' }],
    items: [{ id: 'mirror', room_id: 'bath', product_id: 'product', product: { id: 'product', dimensions: null } } as MaterialItem],
    findings: [finding], issues: [issue], checkedAt: 'now', itemCount: 1, document: null, message: 'Review ready', onSaveDetail: vi.fn() }));
  expect(html).toContain('Dimensions for Mirror'); expect(html).toContain('Save &amp; complete');
  expect(html).toContain('Use suggested dimensions'); expect(html).toContain('Confirm the selected product');
  expect(html).not.toContain('Price is per');
});
