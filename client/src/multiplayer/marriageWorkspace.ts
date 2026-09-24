import type { MarriageView } from './marriage';

export type MarriageDecision = 'DECLARE_TUNNELAS' | 'DECLARATION_WAIT' | 'WAITING' | 'DRAW_REQUIRED' | 'DISCARD_REQUIRED' | 'FINISH_REQUIRED';
export type HandSnap = 'collapsed' | 'expanded';

// Presentation only: permissions and card legality always come from the server.
export function marriageDecision(view: MarriageView | undefined, playing: boolean): MarriageDecision {
  const mine = view?.private;
  if (playing && mine && view?.public.tunnela_declaration_pending) return mine.actions.kinds.includes('declare_tunnelas')?'DECLARE_TUNNELAS':'DECLARATION_WAIT';
  if (!playing || !mine || mine.player_id !== view?.public.current_player_id) return 'WAITING';
  if (mine.actions.kinds.includes('draw') && mine.actions.drawable_sources.length) return 'DRAW_REQUIRED';
  if (mine.actions.kinds.includes('discard')) return 'DISCARD_REQUIRED';
  if (mine.actions.kinds.includes('finish')) return 'FINISH_REQUIRED';
  return 'WAITING';
}
export function marriageHandSnap(decision: MarriageDecision): HandSnap {
  return decision === 'DECLARE_TUNNELAS' || decision === 'DECLARATION_WAIT' || decision === 'DISCARD_REQUIRED' || decision === 'FINISH_REQUIRED' ? 'expanded' : 'collapsed';
}

export function marriageHandLayout(count: number, width: number) {
  const cardWidth = 58, cardHeight = 86;
  const columns = Math.max(1, Math.min(8, Math.floor((width - cardWidth) / 38) + 1));
  const step = columns > 1 ? Math.min(62, (width - cardWidth) / (columns - 1)) : 0;
  return { cardWidth, cardHeight, columns, step, height: Math.max(1, Math.ceil(count / columns)) * 100 + 14 };
}
