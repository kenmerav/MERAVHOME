import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
vi.mock('@/lib/specCompletionClient', () => ({ fetchSpecCompletion: vi.fn(), fetchBoardColorSuggestion: vi.fn(),
  fetchPlanDimensionSuggestion: vi.fn(), fetchSavedSpecCompletion: vi.fn(), updateCompletionIssue: vi.fn() }));
import { SpecCompletionResults } from '@/components/SpecCompletionReview';
import type { MaterialItem } from '@/lib/db';
import type { CompletionFinding } from '@/lib/specCompletion';
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
});
