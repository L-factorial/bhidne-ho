export const POKE_TEXT_LIMIT = 25;
export const QUICK_POKES = ['Your move, legend!', 'Nice one!', 'Big talk, small tricks!', 'Spades have entered!', 'Bhidne ho? 😏', 'Plot twist!'];
export type PlayerPhrase = { id: string; text: string; created_by: string };
export type RoomPoke = {
  type: 'ROOM_POKE'; id: string; room_id: string; match_id: string;
  sender_id: string; sender_player_id: number; recipient_id: string | null;
  recipient_player_id: number | null; scope: 'private' | 'table'; text: string; expires_at: number;
};
export const limitPokeText = (text: string) => Array.from(text).slice(0, POKE_TEXT_LIMIT).join('');
export const pokeTextLength = (text: string) => Array.from(text).length;

export function readPoke(value: unknown, roomId: string, userId: string, now = Date.now()): RoomPoke | null {
  if (!value || typeof value !== 'object') return null;
  const poke = value as RoomPoke;
  if (poke.type !== 'ROOM_POKE' || poke.room_id !== roomId || typeof poke.id !== 'string'
      || typeof poke.match_id !== 'string' || typeof poke.sender_id !== 'string'
      || !Number.isInteger(poke.sender_player_id) || poke.sender_player_id < 1
      || typeof poke.text !== 'string' || !poke.text.trim() || pokeTextLength(poke.text) > POKE_TEXT_LIMIT
      || !Number.isFinite(poke.expires_at) || poke.expires_at <= now) return null;
  if (poke.scope === 'private') {
    if (poke.recipient_id !== userId || !Number.isInteger(poke.recipient_player_id)) return null;
  } else if (poke.scope !== 'table' || poke.recipient_id !== null || poke.recipient_player_id !== null) return null;
  return poke;
}

export function appendPoke(current: RoomPoke[], next: RoomPoke, now = Date.now()): RoomPoke[] {
  const live = current.filter(item => item.room_id === next.room_id && item.expires_at > now);
  return live.some(item => item.id === next.id) ? live : [...live, next].slice(-3);
}
