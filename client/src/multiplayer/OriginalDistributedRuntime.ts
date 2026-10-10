import { OriginalUiApi } from './OriginalUiApi.ts';
import { registerRuntimeRequests } from './RuntimeRequests.ts';
import type { UiRequest } from './RuntimeRequests.ts';
import { DistributedRootRuntime } from './DistributedRoot.ts';
import type { RootCallbacks } from './DistributedRoot.ts';
import { DistributedRoomActions, RoomActionPending, RoomActionRejected } from './DistributedRoomActions.ts';
import type { RecoveredRoomAction } from './DistributedRoomActions.ts';
import { OwnedSession } from './JournalOwner.ts';
import type { AcquireJournal, JournalOwner } from './JournalOwner.ts';
import type { RoomActions } from './RoomActions';
import type { Session } from './session';
import {newCommandId} from './DurableCommandClient.ts';
import type {Json} from './DurableCommandClient.ts';
import type {CommandJournal} from './CommandJournal.ts';
import {GameRequestError} from './PendingGameAction.ts';
import type {Room} from './session';
import type {CreationFeedback} from './creationProgress';

const roomSlot = 'original-room-actions';

// Authenticated owner for the original screens. Navigation changes may replace
// children, but never this owner or its command slots. Keep production activation
// separate until every original screen has a distributed adapter.
export class OriginalDistributedRuntime {
  private journal:CommandJournal;
  private flowRunning=false;
  private flowTimer?:ReturnType<typeof setTimeout>;
  get creationFlow(){return this.closed?null:this.journal.creationFlow;}
  finishCreationFlow(){this.journal.saveCreationFlow(null);}
  readonly creationFeedback=new Map<string,CreationFeedback>();
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
    this.journal=owner.journal;
    this.root = new DistributedRootRuntime(owner,base,account.token,{...callbacks,transient:payload=>{
      if((payload as {type?:string})?.type==='TABLE_CHAT_MESSAGE')this.api?.deliverEphemeral(payload);
      else callbacks.transient?.(payload);
    },install:(lane,view)=>{
      callbacks.install(lane,view);
      if(view.kind==='chat')void this.api?.deliverChat(lane,view.value).catch(error=>callbacks.error(lane,error));
    }},options);
    this.actions = new DistributedRoomActions(this.account,this.root.session.command(roomSlot),30000);
    // Stable facade: acknowledging an observed outcome retires its slot, without
    // forcing existing screens to capture a disposed adapter.
    this.roomActions = {
      create: async (session,input) => {
        try {
          const result=await this.availableActions().create(session,input);
          const id=this.roomCommandId;
          if(id)this.acknowledgeRoomAction(id);
          this.clearCreationFeedback('room');
          return result;
        } catch(error) {
          if(error instanceof RoomActionRejected)this.recordCreationFeedback({id:this.roomCommandId??'room',kind:'room',error:error.message});
          throw error;
        }
      },
      enter: (session,room) => this.availableActions().enter(session,room),
      leave: (session,room) => this.availableActions().leave(session,room),
      remove: (session,room) => this.availableActions().remove(session,room),
    };
  }
  clearCreationFeedback(kind:'room'|'table') { for(const [id,item] of this.creationFeedback)if(item.kind===kind)this.creationFeedback.delete(id); }
  recordCreationFeedback(item:CreationFeedback) {this.clearCreationFeedback(item.kind);this.creationFeedback.set(item.id,item);}
  connectRequests(shared: UiRequest) {
    if (this.closed || this.api) throw Error('API runtime already connected or closed.');
    const api = new OriginalUiApi(this.root,this.account,shared);
    api.onCreationResolved=notice=>{if(this.creationFlow?.room?.room_id===notice.roomId)this.finishCreationFlow();};
    try { this.unregister = registerRuntimeRequests(this.account,api.request,api.observeChat); this.api=api;void this.resumeCreationFlow().catch(()=>{}); }
    catch (error) { api.close(); throw error; }
  }
  async createGame(room:Room|null,defaultName:string,payload:{[key:string]:Json}) {
    if(this.creationFlow)throw new RoomActionPending();
    this.clearCreationFeedback('table');
    this.journal.saveCreationFlow({id:newCommandId(),room,defaultName,payload});
    return this.resumeCreationFlow();
  }
  private async resumeCreationFlow():Promise<{room:Room;gameType:string;matchId:string}|null> {
    if(this.flowRunning||!this.api||this.closed||!this.creationFlow)return null;
    this.flowRunning=true;
    try {
      let flow=this.creationFlow!;
      let room=flow.room as Room|null;
      if(!room){
        room=await this.actions.create(this.account,{name:flow.defaultName,visibility:'public',invitees:[]});
        flow={...flow,room};this.journal.saveCreationFlow(flow);
        if(this.roomCommandId)this.acknowledgeRoomAction(this.roomCommandId);
      }
      if(this.root.session.command(roomSlot).request?.body.command==='create-room'){
        await this.actions.recover(this.account);
        if(this.roomCommandId)this.acknowledgeRoomAction(this.roomCommandId);
      }
      await this.actions.enter(this.account,room.room_id);
      if(this.roomCommandId)this.acknowledgeRoomAction(this.roomCommandId);
      if(!this.creationFlow)return null;
      const result=await this.api.request<{match_id:string}>(`/test-games/${encodeURIComponent(room.room_id)}`,this.account,flow.payload);
      if(this.closed)return null;
      this.finishCreationFlow();
      return {room,gameType:String(flow.payload.game_type),matchId:result.match_id};
    } catch(error) {
      if(this.closed)return null;
      const flow=this.creationFlow;
      if(error instanceof GameRequestError||error instanceof RoomActionRejected){
        if(flow)this.recordCreationFeedback({id:flow.id,kind:'table',roomId:flow.room?.room_id,error:(error as Error).message});
        this.finishCreationFlow();
        throw error;
      }
      if(this.creationFlow)this.flowTimer=setTimeout(()=>void this.resumeCreationFlow().catch(()=>{}),1500);
      throw error;
    } finally {this.flowRunning=false;}
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
    this.closed = true;clearTimeout(this.flowTimer);
    this.unregister?.(); this.api?.close(); this.api=null;
    this.actions.dispose(); this.root.close(); this.recovered = null;
  }
}

// Account/token changes close the previous runtime before releasing its exclusive
// journal lock. An acquisition completing after logout is discarded by OwnedSession.
export function originalDistributedOwner(acquire: AcquireJournal) {
  return new OwnedSession<OriginalDistributedRuntime>(acquire);
}
