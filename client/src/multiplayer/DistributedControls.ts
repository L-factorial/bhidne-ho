import type { DurableCommandClient, CommandTarget, Json } from './DurableCommandClient.ts';
export type SelectedTable = {
  room_id: string; table_id: string; match_id: string; table_revision: number;
  durable_game_id: string | null; game?: { revision: number };
};
function revision(n: number | undefined): number {
  if (!Number.isSafeInteger(n) || n! < 0) throw Error('A committed revision is required.');
  return n!;
}
function id(s: string | null): string { if (!s) throw Error('A selected durable identity is required.');return s; }
export function tableTarget(view: SelectedTable): CommandTarget {
  return {kind:'table',room_id:id(view.room_id),table_id:id(view.table_id)};
}
export function gameTarget(view: SelectedTable): CommandTarget {
  return {...tableTarget(view),kind:'game',game_id:id(view.durable_game_id)};
}
export function tableControl(client: DurableCommandClient, view: SelectedTable, command: string, payload: {[key:string]:Json} = {}) {
  return client.begin(tableTarget(view),{command,payload,match_id:id(view.match_id),expected_revision:revision(view.table_revision)});
}
export function gameControl(client: DurableCommandClient, view: SelectedTable, command: string, payload: {[key:string]:Json} = {}) {
  return client.begin(gameTarget(view),{command,payload,match_id:id(view.match_id),expected_revision:revision(view.game?.revision)});
}
export function roomControl(client: DurableCommandClient, room: string, command: string, payload: {[key:string]:Json} = {}) {
  return client.begin({kind:'room',room_id:id(room)},{command,payload});
}
export function chatControl(client: DurableCommandClient, target: CommandTarget, text: string) {
  if (!['room_chat','table_chat','game_chat','conversation'].includes(target.kind)) throw Error('Invalid chat target.');
  return client.begin(target,{command:target.kind === 'conversation' ? 'send-message' : 'send-chat',payload:{text}});
}
export function readNotifications(client: DurableCommandClient, target: CommandTarget, ids: string[]) {
  if (target.kind !== 'recipient' || ids.length < 1 || ids.length > 100) throw Error('Invalid notification read target.');
  return client.begin(target,{command:'read-notifications',payload:{ids}});
}
export function friendshipControl(client: DurableCommandClient, actor: string, other: string, action: 'request-friend'|'accept-friend'|'remove-friend') {
  const uuid = (value: string) => {
    const normalized = value.replace(/^user-/, '').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) throw Error('Invalid player identity.');
    return normalized;
  };
  const pair = [uuid(actor),uuid(other)].sort();
  if (pair[0] === pair[1]) throw Error('Choose another player.');
  return client.begin({kind:'conversation',user_low:pair[0],user_high:pair[1]},{command:action,payload:{}});
}
export function settlementControl(client: DurableCommandClient, room: string,
  intent: {scope:'table';table_id:string}|{scope:'game';table_id:string;game_id:string}|{batch_id:string;transfer_id:string;action:'mark-paid'|'confirm'}) {
  return roomControl(client,room,'action' in intent ? 'settlement-action':'create-settlement',intent);
}
// The selected scope is captured at begin; retry never reselects a newer game,
// Flush round, table revision or leave operation. Server validates commands/rules.
