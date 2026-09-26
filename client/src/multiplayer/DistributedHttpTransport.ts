import type { DurableCommandTransport } from './DurableCommandClient.ts';

export class DistributedRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Distributed request failed (${status}); outcome unresolved.`); this.status = status;
  }
}

// baseUrl is the explicit /distributed prefix; no guessed legacy route fallback.
export function distributedHttpTransport(baseUrl: string, token: string,
  fetcher: typeof fetch = globalThis.fetch): DurableCommandTransport {
  async function request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await fetcher(baseUrl.replace(/\/$/, '') + path, {
      method: body === undefined ? 'GET' : 'POST', signal, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new DistributedRequestError(response.status);
    return response.json(); // DurableCommandClient validates receipts before journaling.
  }
  return {
    submit: (envelope, signal) => {
      if (envelope.target.kind === 'catalog') {
        if (envelope.body.command !== 'create-room' || envelope.body.match_id != null || envelope.body.expected_revision != null) {
          return Promise.reject(new Error('Invalid catalog operation.'));
        }
        return request('/rooms', signal, {...envelope.body.payload, command_id:envelope.body.command_id});
      }
      return request('/commands', signal, envelope);
    },
    status: (reference, signal) => request(`/commands/${encodeURIComponent(reference.lane_id)}/${encodeURIComponent(reference.command_id)}`, signal),
  };
}
