import type { DurableCommandClient, DurableReceipt, Json, CommandTarget } from './DurableCommandClient.ts';
import { gameControl, tableControl, roomControl, chatControl, readNotifications, friendshipControl, settlementControl } from './DistributedControls.ts';
import type { SelectedTable } from './DistributedControls.ts';
export type LeaveView = SelectedTable & {
  game_type: 'callbreak'|'marriage'|'flush';
  table: { phase: string; current_user: { can_leave_seat: boolean; can_abandon_match: boolean; is_in_active_match: boolean } };
};
export function leaveControl(client: DurableCommandClient, view: LeaveView): boolean {
  // An unresolved intention is retried as-is, even if the latest screen is gone.
  if (client.pending) return false;
  const {phase,current_user:user} = view.table;
  if (['OPEN','COMPLETED','ENDED'].includes(phase) && user.can_leave_seat) return tableControl(client,view,'leave-seat');
  if (phase === 'STARTED' && view.game_type === 'callbreak' && user.can_abandon_match) return tableControl(client,view,'abandon');
  if (phase === 'STARTED' && ['marriage','flush'].includes(view.game_type) && user.is_in_active_match) {
    return gameControl(client,view,'FOLD_AND_LEAVE');
  }
  throw Error('Leaving is unavailable in the current table state.');
}
export type ScreenActionState = {
  status: 'idle'|'pending'|'accepted'|'rejected'; busy: boolean;
  commandId: string | null; error: string; receipt: DurableReceipt | null;
};
type Payload = {[key:string]:Json};
// One controller per screen intention slot; the session owns the command, not the
// screen. Dispose removes UI observers/cancels its wait, never deletes the journal.
export class DistributedScreenController {
  private command: DurableCommandClient;
  private changed: (state: ScreenActionState) => void;
  private accepted: (receipt: DurableReceipt) => void;
  private unsubscribe: () => void;
  private armed: string | null = null;
  private delivered: string | null = null;
  private error = '';
  private active: AbortController | null = null;
  private disposed = false;
  constructor(command: DurableCommandClient, callbacks: {
    changed(state: ScreenActionState): void; accepted(receipt: DurableReceipt): void;
  }) {
    this.command = command; this.changed = callbacks.changed; this.accepted = callbacks.accepted;
    this.unsubscribe = command.observe(() => this.update());
  }
  get state(): ScreenActionState {
    const receipt = this.command.latest;
    return {status:this.command.pending?'pending':receipt?.status??'idle',busy:this.command.pending||this.active!==null,
      commandId:this.command.request?.body.command_id??null,receipt,
      error:receipt?.status==='rejected' && 'outcome' in receipt ? receipt.outcome?.detail || 'Action rejected.':this.error};
  }
  private update() {
    if (this.disposed) return;
    const state=this.state;
    try { this.changed(state); } catch { /* Rendering cannot change durable outcomes. */ }
    if (state.receipt?.status === 'accepted' && state.commandId === this.armed && this.delivered !== this.armed) {
      this.delivered=this.armed;
      try { this.accepted(state.receipt); } catch { /* Navigation is not a command retry. */ }
    }
  }
  async submit(begin: () => boolean): Promise<boolean> {
    if (this.disposed || this.active || this.command.pending) return false;
    this.error='';
    try {
      if (!begin()) return false;
      this.armed=this.command.request!.body.command_id;
      await this.recover();return true;
    } catch (e) { this.error=e instanceof Error?e.message:'Action unavailable.';this.update();return false; }
  }
  async recover(): Promise<void> {
    if (this.disposed || this.active) return;
    this.armed=this.command.request?.body.command_id??null;
    const abort=new AbortController();this.active=abort;this.error='';this.update();
    try { await this.command.reconcile(abort.signal); }
    catch (e) { if (!abort.signal.aborted) this.error=e instanceof Error?e.message:'Waiting for confirmation.'; }
    finally { this.active=null;this.update(); }
  }
  game(view: SelectedTable, command: string, payload: Payload = {}) { return this.submit(()=>gameControl(this.command,view,command,payload)); }
  table(view: SelectedTable, command: string, payload: Payload = {}) { return this.submit(()=>tableControl(this.command,view,command,payload)); }
  room(room: string, command: string, payload: Payload = {}) { return this.submit(()=>roomControl(this.command,room,command,payload)); }
  leave(view: LeaveView) { return this.submit(()=>leaveControl(this.command,view)); }
  lobby(view: LeaveView, action: '/join'|'/leave'|'/start'|'/end'|'/settings'|'/marriage-settings'|'/flush-settings'|'/rule-vote'|'/next-deal', payload: Payload = {}) {
    if (action === '/leave') return this.leave(view);
    if (action === '/next-deal') return this.game(view,'NEXT_DEAL',payload);
    const commands = { '/join':'join-seat', '/start':'start', '/end':'end', '/settings':'settings',
      '/marriage-settings':'marriage-settings', '/flush-settings':'flush-settings', '/rule-vote':'rule-vote' };
    return this.table(view,commands[action],payload);
  }
  chat(target: CommandTarget, text: string) { return this.submit(()=>chatControl(this.command,target,text)); }
  read(target: CommandTarget, ids: string[]) { return this.submit(()=>readNotifications(this.command,target,ids)); }
  friendship(actor: string, other: string, action: Parameters<typeof friendshipControl>[3]) {
    return this.submit(()=>friendshipControl(this.command,actor,other,action));
  }
  settlement(room: string, intent: Parameters<typeof settlementControl>[2]) {
    return this.submit(()=>settlementControl(this.command,room,intent));
  }
  createRoom(name: string, visibility: 'public'|'private', invitees: string[] = []) {
    return this.submit(()=> {
      if (!name.trim() || name.length > 60 || !['public','private'].includes(visibility)
          || invitees.length > 20 || invitees.some(id=>!id)) throw Error('Invalid room creation fields.');
      return this.command.begin({kind:'catalog'},{command:'create-room',payload:{name,visibility,invitees}});
    });
  }
  dispose() { this.disposed=true;this.active?.abort();this.unsubscribe(); }
}
