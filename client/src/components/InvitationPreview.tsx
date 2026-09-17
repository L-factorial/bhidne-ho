import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Invitation } from '../multiplayer/invitations';
import type { Room, Session } from '../multiplayer/session';
import { useTheme } from '../theme';

export function InvitationPreview({ invitation, session, join, dismiss }: {
  invitation: Invitation; session: Session;
  join: (room: Room, gameType?: string, matchId?: string) => Promise<boolean>; dismiss: () => void;
}) {
  const { colors } = useTheme();
  const [target, setTarget] = useState<Room | null>(null), [gameType, setGameType] = useState<string>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const joinRef = useRef(join); joinRef.current = join;
  useEffect(() => {
    const controller = new AbortController(); setError(''); setBusy(true); setTarget(null);
    async function load() {
      try {
        const state = await request<Room & { tables?: { match_id: string; game_type: string; status: string }[] }>(
          `/rooms/${encodeURIComponent(invitation.roomId)}`, session, undefined, controller.signal);
        const room: Room = state;
        const invitedGame = invitation.matchId ? state.tables?.find(table => table.match_id === invitation.matchId) : undefined;
        if (invitation.matchId && (!invitedGame || invitedGame.status === 'ended'))
          throw new Error('This game is no longer available. Ask for a new game link.');
        if (controller.signal.aborted) return;
        setTarget(room); setGameType(invitedGame?.game_type);
        if (invitation.matchId && !await joinRef.current(room, invitedGame?.game_type, invitation.matchId))
          throw new Error('Could not enter the game’s room. Try again.');
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not open invitation.'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  }, [invitation.roomId, invitation.matchId, session.token, attempt]);
  return <View style={{ padding: 20, gap: 12, backgroundColor: colors.surface }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 22 }}>{invitation.matchId ? 'Game invitation' : 'Room invitation'}</Text>
    {target && <Text style={{ color: colors.text }}>{target.name} · {target.members.length} room members</Text>}
    <Text style={{ color: colors.text }}>{invitation.matchId ? 'Entering the room. You can choose whether to take a game seat.' : 'Preview this room, then choose Join room when you’re ready. Joining the room does not take a game seat.'}</Text>
    {busy && <Text style={{ color: colors.text }}>Opening invitation…</Text>}
    {!!error && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(a => a + 1)}><Text style={{ color: colors.accent }}>Retry invitation</Text></Pressable></>}
    {!invitation.matchId && target && <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
      setBusy(true); const entered = await join(target, gameType); if (!entered) { setError('Could not join room. Try again.'); setBusy(false); }
    }} style={{ padding: 12 }}><Text style={{ color: colors.accent }}>Join room</Text></Pressable>}
    <Pressable accessibilityRole="button" onPress={dismiss} style={{ padding: 12 }}><Text style={{ color: colors.accent }}>Dismiss invitation</Text></Pressable>
  </View>;
}
