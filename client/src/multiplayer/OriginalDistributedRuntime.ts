import { OriginalUiApi } from './OriginalUiApi.ts';
import { registerRuntimeRequests } from './RuntimeRequests.ts';
import type { UiRequest } from './RuntimeRequests.ts';
import { DistributedRootRuntime } from './DistributedRoot.ts';
import type { RootCallbacks } from './DistributedRoot.ts';
import { DistributedRoomActions, RoomActionPending } from './DistributedRoomActions.ts';
import type { RecoveredRoomAction } from './DistributedRoomActions.ts';
import { OwnedSession } from './JournalOwner.ts';
import type { AcquireJournal, JournalOwner } from './JournalOwner.ts';
import type { RoomActions } from './RoomActions';
import type { Session } from './session';

const roomSlot = 'original-room-actions';

// Authenticated owner for the original screens. Navigation changes may replace
// children, but never this owner or its command slots. Keep production activation
// separate until every original screen has a distributed adapter.
export class OriginalDistributedRuntime {
  readonly root: DistributedRootRuntime;
  readonly roomActions: RoomActions;
  api: OriginalUiApi | null = null;
  private unregister: (()=>void) | null = null;
  private actions: DistributedRoomActions;
  private account: Session;
  private closed = false;
  private recovering: Promise<RecoveredRoomAction | null> | null = null;
  private recovered: RecoveredRoomAction | null = null;

  constructor(owner: JournalOwner, base: string, account: Session, callbacks: RootCallbacks,
    options: ConstructorParameters<typeof DistributedRootRuntime>[4] = {}) {
    this.account = {...account};
    this.root = new DistributedRootRuntime(owner,base,account.token,{...callbacks,install:(lane,view)=>{
      callbacks.install(lane,view);
      if(view.kind==='chat')void this.api?.deliverChat(lane,view.value).catch(error=>callbacks.error(lane,error));
    }},options);
    this.actions = new DistributedRoomActions(this.account,this.root.session.command(roomSlot),30000);
    // Stable facade: acknowledging an observed outcome retires its slot, without
    // forcing existing screens to capture a disposed adapter.
    this.roomActions = {
      create: (session,input) => this.availableActions().create(session,input),
      enter: (session,room) => this.availableActions().enter(session,room),
      leave: (session,room) => this.availableActions().leave(session,room),
      remove: (session,room) => this.availableActions().remove(session,room),
    };
  }
  connectRequests(shared: UiRequest) {
    if (this.closed || this.api) throw Error('API runtime already connected or closed.');
    const api = new OriginalUiApi(this.root,this.account,shared);
    try { this.unregister = registerRuntimeRequests(this.account,api.request); this.api=api; }
    catch (error) { api.close(); throw error; }
  }
  private availableActions() {
    if (this.closed) throw Error('Authenticated runtime closed.');
    if (this.recovered || this.recovering) throw new RoomActionPending();
    return this.actions;
  }
  get roomCommandId() { return this.root.session.command(roomSlot).request?.body.command_id ?? null; }
  recoverRoomAction(): Promise<RecoveredRoomAction | null> {
    if (this.closed) return Promise.reject(Error('Authenticated runtime closed.'));
    if (this.recovered) return Promise.resolve(structuredClone(this.recovered));
    if (this.recovering) return this.recovering;
    this.recovering = this.actions.recover(this.account).then(result => {
      if (this.closed) throw Error('Authenticated runtime closed.');
      this.recovered = result;
      return structuredClone(result);
    }).finally(() => { this.recovering = null; });
    return this.recovering;
  }
  // Call ONLY after persisting the recovered navigation/error in the original
  // session. A lost response or pending result can never be acknowledged away.
  acknowledgeRoomAction(commandId: string) {
    if (this.closed || this.recovering) throw Error('Room recovery is not ready.');
    const command = this.root.session.command(roomSlot);
    if (command.request?.body.command_id !== commandId || command.pending || !command.latest) {
      throw Error('Room action is not confirmed.');
    }
    if (!this.root.session.releaseCommand(roomSlot)) throw Error('Room action is not confirmed.');
    this.actions.dispose();
    this.actions = new DistributedRoomActions(this.account,this.root.session.command(roomSlot),30000);
    this.recovered = null;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.unregister?.(); this.api?.close(); this.api=null;
    this.actions.dispose(); this.root.close(); this.recovered = null;
  }
}

// Account/token changes close the previous runtime before releasing its exclusive
// journal lock. An acquisition completing after logout is discarded by OwnedSession.
export function originalDistributedOwner(acquire: AcquireJournal) {
  return new OwnedSession<OriginalDistributedRuntime>(acquire);
}
