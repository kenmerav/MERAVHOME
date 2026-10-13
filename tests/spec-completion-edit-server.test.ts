import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ responses: {} as Record<string, any[]>, writes: [] as any[], filters: [] as any[],
  status: vi.fn(), read: vi.fn(), auth: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  const query: any = { select: () => query, eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return query; },
    is: (key: string, value: unknown) => { state.filters.push([table, key, value]); return query; }, limit: () => query,
    update: (patch: any) => { state.writes.push([table, 'update', patch]); return query; },
    insert: (patch: any) => { state.writes.push([table, 'insert', patch]); return query; },
    single: async () => state.responses[table]?.shift(), maybeSingle: async () => state.responses[table]?.shift(),
    then: (resolve: any, reject: any) => Promise.resolve(state.responses[table]?.shift()).then(resolve, reject) };
  return query;
} } }));
vi.mock("@/lib/specCompletion.server", () => ({ authorizeCompletionProject: state.auth }));
vi.mock("@/lib/savedSpecCompletion.server", () => ({ readSavedCompletionReview: state.read, setCompletionIssueStatus: state.status,
  CompletionReviewConflict: class CompletionReviewConflict extends Error {}, CompletionStorageUnavailable: class CompletionStorageUnavailable extends Error {} }));
import { savedSpecCompletionRequest } from "@/lib/savedSpecCompletionApi.server";
const projectId = '9015b5ff-6343-462b-9539-9e62ed1c52d0', productId = 'c9433c68-e619-48d0-bd87-e3a7bde73ed5';
const stamp = '2026-10-13T20:00:00Z', key = 'a'.repeat(64);
const item = { id: 'item', project_id: projectId, room_id: 'room', product_id: productId, updated_at: stamp, color: null,
  product: { id: productId, updated_at: stamp, price: null, markup_percent: null } };
let body: any, issue: any;
beforeEach(() => {
  vi.clearAllMocks(); state.writes = []; state.filters = [];
  body = { project_id: projectId, action: 'detail', issue_key: key, expected_updated_at: null, expected_material_updated_at: stamp,
    expected_product_id: productId, expected_product_updated_at: stamp, value: 'Brushed brass' };
  issue = { status: 'open', status_updated_at: null, finding: { field: 'color', item_id: 'item', room_id: 'room' } };
  state.responses = { spec_completion_reviews: [{ data: { report: { plan_status: 'checked' }, issues: { [key]: issue } }, error: null }],
    material_items: [{ data: item, error: null }, { data: { id: 'item' }, error: null }, { data: { ...item, color: 'Brushed brass' }, error: null }],
    rooms: [{ data: { id: 'room' }, error: null }], products: [{ data: { id: productId }, error: null }],
    room_products: [{ data: [{ id: 'existing-link' }], error: null }] };
  state.auth.mockImplementation(async () => ({ projectId, userId: 'staff', body }));
  state.read.mockResolvedValue({ report: {}, issues: [{ ...issue, status: 'completed' }], stale: true });
  state.status.mockResolvedValue(undefined);
});
const request = () => savedSpecCompletionRequest(new Request('https://studio.test/api/spec-completion-review', { method: 'POST' }));
it('saves only the chosen color and marks only its issue completed afterward', async () => {
  expect((await request()).status).toBe(200);
  expect(state.writes).toEqual([['material_items', 'update', { color: 'Brushed brass' }]]);
  expect(state.filters).toContainEqual(['material_items', 'project_id', projectId]);
  expect(state.filters).toContainEqual(['material_items', 'updated_at', stamp]);
  expect(state.status).toHaveBeenCalledWith(projectId, 'staff', key, 'completed', null);
});
it('updates only price and basis with a product version guard', async () => {
  issue.finding.field = 'price'; body.value = '$250'; body.price_unit = 'unit';
  state.responses.material_items.splice(1, 1);
  expect((await request()).status).toBe(200);
  expect(state.writes).toEqual([['products', 'update', { price: '$250.00', price_unit: 'unit' }]]);
  expect(state.filters).toContainEqual(['products', 'updated_at', stamp]);
  expect(state.status).toHaveBeenCalledOnce();
});
it('saves dimensions without changing pricing or markup, then completes only that issue', async () => {
  issue.finding.field = 'dimensions'; body.value = '30" W × 36" H';
  state.responses.material_items[0] = { data: { ...item, product: { ...item.product, markup_percent: 20 } }, error: null };
  state.responses.material_items.splice(1, 1);
  expect((await request()).status).toBe(200);
  expect(state.writes).toEqual([['products', 'update', { dimensions: '30" W × 36" H' }]]);
  expect(state.filters).toContainEqual(['products', 'updated_at', stamp]);
  expect(state.status).toHaveBeenCalledWith(projectId, 'staff', key, 'completed', null);
});
it('rejects a nonstaff caller before any data read or write', async () => {
  state.auth.mockResolvedValue(Response.json({ error: 'Staff only' }, { status: 403 }));
  expect((await request()).status).toBe(403); expect(state.filters).toEqual([]); expect(state.writes).toEqual([]); expect(state.status).not.toHaveBeenCalled();
});
it('rejects invalid values and arbitrary writable fields', async () => {
  body.value = 'TBD'; expect((await request()).status).toBe(400); expect(state.writes).toEqual([]);
  body.patch = { quantity: 999 }; expect((await request()).status).toBe(400); expect(state.status).not.toHaveBeenCalled();
});
it('rejects a changed selection without completing', async () => {
  body.expected_product_id = null; expect((await request()).status).toBe(409); expect(state.writes).toEqual([]); expect(state.status).not.toHaveBeenCalled();
});
it('does not complete an issue if its write fails', async () => {
  state.responses.material_items[1] = { data: null, error: new Error('Write failed') };
  expect((await request()).status).toBe(500); expect(state.status).not.toHaveBeenCalled();
});
it('reports the persisted detail when its completion status cannot be saved', async () => {
  state.status.mockRejectedValue(new Error('Review changed'));
  const response = await request(); expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('detail was saved');
});
it('prevents inline edits while a paid plan check is still running', async () => {
  state.responses.spec_completion_reviews[0].data.report.plan_status = 'checking';
  expect((await request()).status).toBe(409); expect(state.writes).toEqual([]); expect(state.status).not.toHaveBeenCalled();
});
it('rejects a stale product version or markup calculation without writing', async () => {
  issue.finding.field = 'price'; body.value = '125'; body.price_unit = 'unit'; body.expected_product_updated_at = '2026-10-12T20:00:00Z';
  expect((await request()).status).toBe(409); expect(state.writes).toEqual([]); expect(state.status).not.toHaveBeenCalled();
});
it('does not mark a concurrent product write conflict completed', async () => {
  issue.finding.field = 'price'; body.value = '125'; body.price_unit = 'unit';
  state.responses.products[0] = { data: null, error: null };
  expect((await request()).status).toBe(409); expect(state.status).not.toHaveBeenCalled();
});
it('can save price on an unassigned material and link only that material and room', async () => {
  issue.finding.field = 'price'; body.value = '125'; body.price_unit = 'unit';
  body.expected_product_id = null; body.expected_product_updated_at = null;
  state.responses.material_items[0] = { data: { ...item, product_id: null, product: null, item_label: 'Sink', category: 'Plumbing' }, error: null };
  state.responses.room_products = [{ data: [], error: null }, { error: null }];
  expect((await request()).status).toBe(200);
  expect(state.writes).toContainEqual(['material_items', 'update', { product_id: productId }]);
  expect(state.writes).toContainEqual(['room_products', 'insert', { room_id: 'room', product_id: productId, is_key_selection: false }]);
  expect(state.writes.find(write => write[0] === 'products')[2]).toMatchObject({ price: '$125.00', price_unit: 'unit', name: 'Sink', category: 'Plumbing' });
  expect(state.filters).toContainEqual(['material_items', 'product_id', null]);
  expect(state.status).toHaveBeenCalledOnce();
});
