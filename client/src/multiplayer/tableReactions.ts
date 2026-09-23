export const tableReactions = {
  love: { label: 'Love', emoji: '❤️' },
  pinch: { label: 'Pinch', emoji: '🤏' },
  clap: { label: 'Clap', emoji: '👏' },
  cheers: { label: 'Cheers', emoji: '🥂' },
  laugh: { label: 'Laugh', emoji: '😂' },
  hammer: { label: 'Playful hammer', emoji: '🔨' },
};
export type ReactionId = keyof typeof tableReactions;
export type TableReaction = {
  type: 'TABLE_REACTION'; id: string; room_id: string; match_id: string;
  sender_id: string; sender_name: string; sender_player_id: number;
  recipient_id: string; recipient_player_id: number; reaction: ReactionId; expires_at: number;
};
export function readTableReaction(value: unknown, roomId: string, matchId?: string, now = Date.now()): TableReaction | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as TableReaction;
  return event.type === 'TABLE_REACTION' && event.room_id === roomId && event.match_id === matchId
    && typeof event.id === 'string' && typeof event.sender_id === 'string' && typeof event.recipient_id === 'string'
    && typeof event.sender_name === 'string' && Number.isInteger(event.sender_player_id) && event.sender_player_id > 0
    && Number.isInteger(event.recipient_player_id) && event.recipient_player_id > 0
    && typeof event.reaction === 'string' && Object.hasOwn(tableReactions, event.reaction)
    && Number.isFinite(event.expires_at) && event.expires_at > now ? event : null;
}
