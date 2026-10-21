import {AppText as Text} from './AppText';
import { playerError } from '../multiplayer/playerError.ts';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useRef, useState } from 'react';
import {Pressable, View} from 'react-native';
import { request } from '../multiplayer/api';
import {isNotificationActivity} from '../notifications/notificationDestination';
import type { Invitation } from '../multiplayer/invitations';
import type { Room, Session } from '../multiplayer/session';
import { useTheme } from '../theme';

export function InvitationPreview({ invitation, session, join, dismiss, ready = true, startupError = '', retrySession }: {
  invitation: Invitation; session: Session; ready?: boolean; startupError?: string; retrySession?: () => void;
  join: (room: Room, gameType?: string, matchId?: string) => Promise<boolean>; dismiss: () => void;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const [target, setTarget] = useState<Room | null>(null), [gameType, setGameType] = useState<string>();
  const [unavailable,setUnavailable]=useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const joinRef = useRef(join); joinRef.current = join;
  useEffect(() => {
    setError(''); setUnavailable(false);setBusy(true); setTarget(null);
    if (!ready) return;
    const controller = new AbortController();
    async function load() {
      try {
        const state = await request<Room & { tables?: { match_id: string; game_type: string; status: string }[] }>(
          `/rooms/${encodeURIComponent(invitation.roomId)}`, session, undefined, controller.signal);
        const room: Room = state;
        if(controller.signal.aborted)return;
        setTarget(room);
        const invitedGame = invitation.matchId ? state.tables?.find(table => table.match_id === invitation.matchId) : undefined;
        if (invitation.matchId && (!invitedGame || invitedGame.status === 'ended')){
          setUnavailable(true);throw new Error(ui("feedback.this_game_is_no_longer_available_ask_for_a_new_game_link"));}
        if (controller.signal.aborted) return;
        setTarget(room); setGameType(invitedGame?.game_type);
        if ((isNotificationActivity(invitation) || (invitation.matchId && !invitation.notificationKind)) && !await joinRef.current(room, invitedGame?.game_type, invitation.matchId))
          throw new Error(ui("feedback.could_not_enter_the_game_s_room_try_again"));
      } catch (error) { if (!controller.signal.aborted) setError(playerError(error, ui("feedback.could_not_open_invitation"))); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  }, [invitation.roomId, invitation.matchId, session.token, attempt, ready, invitation.eventId]);
  return <View style={{ padding: 20, gap: 12, backgroundColor: colors.surface }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 22 }}>{isNotificationActivity(invitation) ? ui('feedback.notification_opening') : invitation.matchId ? ui("social.game_invitation") : ui("rooms.room_invitation")}</Text>
    {target && <Text style={{ color: colors.text }}>{target.name} · {target.members.length} {ui("rooms.room_members")}</Text>}
    <Text style={{ color: colors.text }}>{invitation.matchId ? ui("common.invitation_enter_help") : ui("common.invitation_preview_help")}</Text>
    {busy && !startupError && <Text style={{ color: colors.text }}>{ui("rooms.opening_invitation")}</Text>}
    {!!startupError && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{startupError}</Text><Pressable accessibilityRole="button" onPress={retrySession}><Text style={{ color: colors.accent }}>{ui("rooms.retry_invitation")}</Text></Pressable></>}
    {!!error && <><Text activity accessibilityRole="alert" style={{ color: colors.danger }}>{uiLabel(error, 'feedback')}</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(a => a + 1)}><Text style={{ color: colors.accent }}>{ui("rooms.retry_invitation")}</Text></Pressable></>}
    {unavailable&&target&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void join(target)}><Text style={{color:colors.accent}}>{ui('common.open_room')}</Text></Pressable>}
    {!unavailable&&(!invitation.matchId || !!invitation.notificationKind?.endsWith('invitation')) && target && <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
      setBusy(true); const entered = await join(target, gameType, invitation.matchId); if (!entered) { setError(ui("feedback.could_not_join_room_try_again")); setBusy(false); }
    }} style={{ padding: 12 }}><Text style={{ color: colors.accent }}>{ui(invitation.matchId?"common.open_table":"rooms.join_room")}</Text></Pressable>}
    <Pressable accessibilityRole="button" onPress={dismiss} style={{ padding: 12 }}><Text style={{ color: colors.accent }}>{ui("rooms.dismiss_invitation")}</Text></Pressable>
  </View>;
}
