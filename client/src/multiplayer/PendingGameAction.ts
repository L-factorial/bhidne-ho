export type ActionRequest = {
  command_id: string; match_id: string; expected_revision: number; command: string; payload: object;
};
export type ActionAck = { command_id: string; status: 'accepted' | 'rejected'; revision: number; detail?: string };
type ActionSnapshot = { match_id?: string; action_ack?: ActionAck };

export class GameRequestError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// One unresolved action per mounted table. Keep its original revision and payload.
export class PendingGameAction {
  request: ActionRequest | null = null;

  begin(request: Omit<ActionRequest, 'command_id'>) {
    if (this.request) return false;
    this.request = { ...JSON.parse(JSON.stringify(request)), command_id: newCommandId() };
    return true;
  }

  async reconcile<T extends ActionSnapshot>(snapshot: T, send: (request: ActionRequest) => Promise<T>, signal: AbortSignal): Promise<{ snapshot: T; error: string }> {
    const request = this.request;
    if (!request || signal.aborted) return { snapshot, error: '' };
    if (snapshot.match_id !== request.match_id) {
      this.request = null;
      return { snapshot, error: 'The game changed. Your pending action was not retried.' };
    }
    try {
      const result = await send(request);
      if (signal.aborted || this.request !== request) return { snapshot, error: '' };
      const ack = result.action_ack;
      if (result.match_id !== request.match_id || ack?.command_id !== request.command_id
          || !['accepted', 'rejected'].includes(ack.status) || !Number.isInteger(ack.revision)) {
        throw new Error('Waiting for the server to confirm your action.');
      }
      this.request = null;
      return { snapshot: result, error: ack.status === 'rejected' ? ack.detail || 'Action rejected.' : '' };
    } catch (error) {
      if (signal.aborted || this.request !== request) return { snapshot, error: '' };
      // Membership (403) can briefly disappear while the room socket reconnects.
      if (error instanceof GameRequestError && [400, 401, 404, 409, 422].includes(error.status)) {
        this.request = null;
        return { snapshot, error: error.message };
      }
      throw error;
    }
  }
}

let sequence = 0;
function newCommandId() {
  // Identity comes from authentication, not this non-secret deduplication key.
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
