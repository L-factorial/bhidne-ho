import type { FlushView } from './flush';

export function flushDecision(view: FlushView | undefined, playing: boolean) {
  const pub = view?.public;
  if (!playing || !pub || pub.status === 'finished') return null;
  const actor = pub.pending_show?.target_id ?? pub.pending_side_show?.target_id ?? pub.current_player_id;
  if (!actor) return null;
  const phase = pub.pending_show ? 'show' : pub.pending_side_show ? `side-show:${pub.pending_side_show.revision}` : pub.status;
  return { actor, key: `${pub.round_number}:${phase}:${actor}` };
}

type Observation = { scope: string; decision: string | null; ready: boolean };
export function observeFlushDecision(previous: Observation | null, next: Observation, personal: boolean) {
  return { observation: next, cue: !!previous && previous.scope === next.scope && previous.ready && next.ready
    && personal && next.decision !== null && previous.decision !== next.decision };
}
