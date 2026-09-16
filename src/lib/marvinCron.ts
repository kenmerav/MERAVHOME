export const MARVIN_SCHEDULED_GMAIL_BATCH_SIZE = 12;

export function orderGmailMessageIds(
  retryMessageIds: string[],
  deferredMessageIds: string[],
  currentMessageIds: string[],
) {
  const retryIds = new Set(retryMessageIds);
  const deferredIds = new Set(deferredMessageIds);
  const freshIds = currentMessageIds.filter(
    (messageId) => !retryIds.has(messageId) && !deferredIds.has(messageId),
  );
  // Reserve room in each scheduled batch for retries, fresh mail, and the backlog.
  // Otherwise a full page of fresh Gmail results can starve deferred messages forever.
  return Array.from(
    new Set([
      ...retryMessageIds.slice(0, 3),
      ...freshIds.slice(0, 5),
      ...deferredMessageIds.slice(0, 4),
      ...retryMessageIds.slice(3),
      ...freshIds.slice(5),
      ...deferredMessageIds,
    ]),
  );
}

export function takeScheduledGmailBatch(messageIds: string[], requestedLimit = 150) {
  const limit = Math.max(1, Math.min(150, Math.floor(requestedLimit) || 150));
  return {
    selected: messageIds.slice(0, limit),
    deferred: messageIds.slice(limit),
  };
}
