// Presentation metadata must not replace transport errors or alter durable recovery.
const retrying = new WeakSet<object>();
export function markRetryingRequest(error: unknown): void {
  if (!error || typeof error !== 'object') return;
  const status = (error as {status?: number}).status;
  if (status === undefined || status >= 500 || [408,425,429].includes(status)) retrying.add(error);
}
export function isRetryingRequest(error: unknown): boolean {
  return !!error && typeof error === 'object' && retrying.has(error);
}
