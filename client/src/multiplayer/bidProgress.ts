import { ui } from '../i18n/copy.ts';
export function bidProgress(bid: number, won: number, remaining?: number) {
  const need = Math.max(0, bid - won);
  if (bid <= 0) return { text: ui("callbreak.bid_pending"), state: 'pending' };
  if (need === 0) return { text: ui("callbreak.met"), state: 'met' };
  if (remaining !== undefined && need > Math.max(0, remaining)) return { text: ui("callbreak.cannot_reach_bid"), state: 'missed' };
  return { text: ui("common.need_count", { "count": need }), state: 'chasing' };
}
