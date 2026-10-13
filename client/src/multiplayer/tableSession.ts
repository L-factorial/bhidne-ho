export type TableSession = {
  server_now: number; idle_deadline: number | null; expired_at: number | null;
  required_actions: {seat_id:number;user_id:string;deadline:number}[];
  controls: {seat_id:number;user_id:string;original_user_id:string;mode:'manual'|'auto'|'replacement';
    disconnected_at:number|null;return_pending:boolean}[];
  replacement_offer: {seat_id:number;expires_at:number}|null;
  reclaim: {seat_id:number;pending:boolean}|null;
  removal_reason: 'ACTION_TIMEOUT'|'TIMEOUT_PENDING_DEAL'|null;
};
let serverOffset = 0;
// Fresh response clocks stay outside committed views so replay checksums are stable.
export function observeServerClock(value:string|null, started:number, received:number) {
  if (!value?.trim()) return;
  const server=Number(value);
  if (!Number.isFinite(server) || server<=0 || received<started || received-started>10000) return;
  serverOffset=server-(started+received)/2;
}
export function sessionNow() {return (Date.now()+serverOffset)/1000;}
export function remaining(deadline:number,now:number) {return Math.max(0,Math.ceil(deadline-now));}
export function sessionTime(seconds:number) {
  const value=Math.max(0,Math.ceil(seconds));
  return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
}
export function ownAction(session:TableSession|undefined,user:string) {
  const control=session?.controls.find(c=>c.user_id===user);
  if (control?.mode==='auto') return null;
  return session?.required_actions.find(t=>t.user_id===user)??null;
}

export function sessionCountdown(session: TableSession | undefined, user: string, now: number) {
  if (!session || session.expired_at || session.removal_reason === 'ACTION_TIMEOUT') return null;
  const own = ownAction(session, user);
  const turn = own ?? session.required_actions.find(action => session.controls.find(control => control.seat_id === action.seat_id)?.mode !== 'auto');
  const deadline = session.idle_deadline ?? turn?.deadline;
  if (deadline == null) return null;
  return { time: sessionTime(remaining(deadline, now)), idle: session.idle_deadline != null,
    seatId: turn?.seat_id, warning: !!own && remaining(own.deadline, now) <= 30, waiting: deadline <= now };
}
