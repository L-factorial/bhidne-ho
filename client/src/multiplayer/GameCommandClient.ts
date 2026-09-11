import { PendingGameAction, GameRequestError } from './PendingGameAction.ts';
import type { ActionAck, ActionRequest } from './PendingGameAction.ts';

export type GameSnapshot = { match_id?: string; game?: { revision: number }; action_ack?: ActionAck };
export type GameCommandTransport<T extends GameSnapshot> = {
  snapshot(signal: AbortSignal): Promise<T>;
  action(request: ActionRequest, signal: AbortSignal): Promise<T>;
};

// Games provide their snapshot and command payload types; reliability is shared.
// Keep one instance for the mounted room + authenticated identity.
export class GameCommandClient<T extends GameSnapshot> {
  private action = new PendingGameAction();
  private transport: GameCommandTransport<T>;
  private generation = 0;

  constructor(transport: GameCommandTransport<T>) { this.transport = transport; }
  get pending() { return this.action.request !== null; }

  submit(snapshot: T, command: string, payload: object = {}) {
    if (!snapshot.match_id || !snapshot.game) return false;
    const submitted = this.action.begin({ match_id: snapshot.match_id, expected_revision: snapshot.game.revision, command, payload });
    if (submitted) this.generation++;
    return submitted;
  }

  async refresh(signal: AbortSignal): Promise<{ snapshot: T; error: string }> {
    const generation = this.generation;
    const snapshot = await this.transport.snapshot(signal);
    if (generation !== this.generation) return { snapshot, error: '' };
    return this.action.reconcile(snapshot, body => this.transport.action(body, signal), signal);
  }
}

export function createHttpGameTransport<T extends GameSnapshot>(baseUrl: string, token: string,
  fetcher: typeof fetch = globalThis.fetch): GameCommandTransport<T> & {
    request(suffix?: string, body?: object, signal?: AbortSignal): Promise<T>;
  } {
  async function request(suffix = '', body?: object, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 10000);
    try {
      const response = await fetcher(baseUrl + suffix, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new GameRequestError(response.status,
        typeof data.detail === 'string' ? data.detail : 'Game request failed. Try again.');
      return data;
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
    }
  }
  return { request, snapshot: signal => request('', undefined, signal),
    action: (body, signal) => request('/action', body, signal) };
}
