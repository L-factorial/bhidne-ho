export const tableReactions = {
  love: { label: 'Love', emoji: '❤️' },
  pinch: { label: 'Pinch', emoji: '🤏' },
  clap: { label: 'Clap', emoji: '👏' },
  cheers: { label: 'Cheers', emoji: '🥂' },
  laugh: { label: 'Laugh', emoji: '😂' },
  hammer: { label: 'Playful hammer', emoji: '🔨' },
};
export type ReactionId = keyof typeof tableReactions;
export const PUNCHLINE_LIMIT = 60;
export const punchlinePresets = ['nice_move', 'your_move', 'lucky_cards', 'well_played'] as const;
export type TableReaction = {
  type: 'TABLE_REACTION'; id: string; room_id: string; match_id: string;
  sender_id: string; sender_name: string; sender_player_id: number;
  recipient_id: string; recipient_player_id: number; expires_at: number;
} & ({ reaction: ReactionId; text?: never } | { reaction: 'punchline'; text: string });
export function readTableReaction(value: unknown, roomId: string, matchId?: string, now = Date.now()): TableReaction | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as TableReaction;
  return event.type === 'TABLE_REACTION' && event.room_id === roomId && event.match_id === matchId
    && typeof event.id === 'string' && typeof event.sender_id === 'string' && typeof event.recipient_id === 'string'
    && typeof event.sender_name === 'string' && Number.isInteger(event.sender_player_id) && event.sender_player_id > 0
    && Number.isInteger(event.recipient_player_id) && event.recipient_player_id > 0
    && typeof event.reaction === 'string' && (Object.hasOwn(tableReactions, event.reaction)
      || (event.reaction === 'punchline' && typeof event.text === 'string' && !!event.text.trim()
        && Array.from(event.text).length <= PUNCHLINE_LIMIT && !/[\u0000-\u001f\u007f]/.test(event.text)))
    && Number.isFinite(event.expires_at) && event.expires_at > now ? event : null;
}
