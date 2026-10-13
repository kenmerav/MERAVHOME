import { expect, it } from 'vitest';
import { completionResponse } from '@/lib/specCompletionResponse';
it('turns the plain-text Vercel timeout into a useful error instead of a JSON exception', async () => {
  await expect(completionResponse(new Response('An error occurred FUNCTION_INVOCATION_TIMEOUT', { status: 504 }), 'Could not check completion.'))
    .rejects.toThrow('Open the saved review');
});
it('handles HTML outages and invalid successful responses without showing raw server text', async () => {
  for (const status of [200, 502, 503]) await expect(completionResponse(new Response('<html>error</html>', { status }), 'Could not load review.'))
    .rejects.not.toThrow('Unexpected token');
});
it('preserves scoped API errors and valid JSON results', async () => {
  await expect(completionResponse(Response.json({ error: 'Only Studio staff can check completion.' }, { status: 403 }), 'Failed'))
    .rejects.toThrow('Only Studio staff');
  expect(await completionResponse(Response.json({ plan_status: 'checking' }), 'Failed')).toEqual({ plan_status: 'checking' });
});
