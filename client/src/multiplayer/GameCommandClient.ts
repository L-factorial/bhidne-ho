import { captureReview, isRevisionRejection, reviewRetry, type ReviewIntent } from './callbreakReviewRetry.ts';
import { ui } from '../i18n/copy.ts';
import { PendingGameAction, GameRequestError } from './PendingGameAction.ts';
import { isDealerPickConflict } from './dealerPickRecovery.ts';
import type { ActionAck, ActionRequest } from './PendingGameAction.ts';

export type GameSnapshot = { match_id?: string; status?: string; game?: { revision: number; hand_review_phase_id?: string | null }; action_ack?: ActionAck;
  game_type?: string; flush?: {public: {round_number: number}}; marriage?: { public: { declaration_phase_id?: string | null } } };

export function captureGamePayload(snapshot: GameSnapshot, command: string, payload: object): object {
  if (snapshot.game_type === 'flush' && command === 'SEE_CARDS' && snapshot.flush?.public.round_number)
    return JSON.parse(JSON.stringify({...payload,round_number:snapshot.flush.public.round_number}));
  const reviewPhase = snapshot.game?.hand_review_phase_id;
  if (snapshot.game_type === 'callbreak' && reviewPhase && ['ACCEPT_HAND','CLAIM_REDEAL'].includes(command))
    return JSON.parse(JSON.stringify({...payload,hand_review_phase_id:reviewPhase}));
  const phase = snapshot.marriage?.public.declaration_phase_id;
  return JSON.parse(JSON.stringify(command === 'DECLARE_TUNNELAS' && snapshot.game_type === 'marriage' && phase
    ? {...payload, declaration_phase_id: phase} : payload));
}
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
  private review: ReviewIntent | null = null;
  private reviewRetries = 0;
  private reviewConflict: {request: ActionRequest; error: string} | null = null;
  private selectionConflict: {match: string; revision: number} | null = null;

  constructor(transport: GameCommandTransport<T>) { this.transport = transport; }
  get pending() { return this.action.request !== null || this.reviewConflict !== null || this.selectionConflict !== null; }

  private finishSelectionConflict(snapshot: T): {snapshot:T;error:string} {
    const conflict = this.selectionConflict!;
    if (snapshot.status !== 'ended' && snapshot.match_id === conflict.match && (snapshot.game?.revision ?? -1) < conflict.revision)
      throw Error(ui('feedback.waiting_for_the_server_to_confirm_your_action'));
    this.selectionConflict = null;
    return {snapshot,error:''};
  }

  submit(snapshot: T, command: string, payload: object = {}) {
    if (this.pending || !snapshot.match_id || !snapshot.game) return false;
    const submitted = this.action.begin({ match_id: snapshot.match_id, expected_revision: snapshot.game.revision, command,
      payload: captureGamePayload(snapshot, command, payload) });
    if (submitted) { this.generation++; this.review = captureReview(snapshot, command); this.reviewRetries = 0; }
    return submitted;
  }

  async refresh(signal: AbortSignal): Promise<{ snapshot: T; error: string }> {
    const generation = this.generation;
    let snapshot = await this.transport.snapshot(signal);
    if (generation !== this.generation) return { snapshot, error: '' };
    if (signal.aborted) return {snapshot,error:''};
    if (this.selectionConflict) return this.finishSelectionConflict(snapshot);
    while (true) {
      if (signal.aborted || generation !== this.generation) return {snapshot,error:''};
      if (this.reviewConflict && this.review) {
        const conflict = this.reviewConflict;
        const decision = reviewRetry(this.review,snapshot);
        if (decision === 'resolved') { this.reviewConflict = null; return {snapshot,error:''}; }
        if (decision !== 'retry' || snapshot.game!.revision <= conflict.request.expected_revision || this.reviewRetries >= 5) { this.reviewConflict = null; return {snapshot,error:conflict.error}; }
        this.reviewRetries++;
        this.action.begin({...conflict.request, expected_revision:snapshot.game!.revision});
        this.reviewConflict = null;
      }
      const request = this.action.request;
      const result = await this.action.reconcile(snapshot, body => this.transport.action(body, signal), signal);
      if (request && isDealerPickConflict(request.command, result.error)
          && !signal.aborted && generation === this.generation) {
        // Retain recovery across read failures so the fading activity line stays
        // visible and a fresh tap cannot overlap an unresolved screen refresh.
        this.selectionConflict = {match:request.match_id,
          revision:result.snapshot.action_ack?.revision ?? result.snapshot.game?.revision ?? request.expected_revision};
        snapshot = await this.transport.snapshot(signal);
        if (signal.aborted || generation !== this.generation) return {snapshot,error:''};
        return this.finishSelectionConflict(snapshot);
      }
      if (!request || !this.review || !isRevisionRejection(result.error) || signal.aborted || generation !== this.generation) return result;
      // Keep the rejected intention while obtaining a fresh view. A read failure
      // must not discard it or turn it into a blind resubmission.
      this.reviewConflict = {request,error:result.error};
      snapshot = await this.transport.snapshot(signal);
    }
  }
}

export function createHttpGameTransport<T extends GameSnapshot>(baseUrl: string, token: string,
  fetcher: typeof fetch = globalThis.fetch, selectedMatch: () => string | undefined = () => undefined): GameCommandTransport<T> & {
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
        typeof data.detail === 'string' ? data.detail : data.detail?.detail || ui("feedback.game_request_failed_try_again"),
        typeof data.detail === 'object' ? data.detail : undefined);
      return data;
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
    }
  }
  return { request, snapshot: signal => { const match = selectedMatch(); return request(match ? `?match_id=${encodeURIComponent(match)}` : '', undefined, signal); },
    action: (body, signal) => request('/action', body, signal) };
}
