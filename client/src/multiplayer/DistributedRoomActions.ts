import { ApiError } from './apiResponse.ts';
import type { CommandEnvelope, CommandTarget, DurableCommandClient, DurableReceipt, Json } from './DurableCommandClient.ts';
import type { CreateRoomInput, RoomActions } from './RoomActions';
import type { Room, Session } from './session';

type Intent = { target: CommandTarget; command: string; payload: { [key: string]: Json } };
export type RecoveredRoomAction = { command: string; roomId: string; room?: Room };

export class RoomActionPending extends Error {
  constructor() { super('Waiting for confirmation of the original room action. Please retry.'); }
}
export class RoomActionRejected extends ApiError {
  constructor(message:string,detail?:ApiError['detail']){super(409,message,detail);}
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function intent(request: CommandEnvelope): Intent {
  return { target: request.target, command: request.body.command, payload: request.body.payload };
}

// One instance and one dedicated journal slot per authenticated app lifetime.
// It never owns/clears the command journal; the root runtime owns that lifetime.
// Not selected by the production build until the remaining UI contracts are ready.
export class DistributedRoomActions implements RoomActions {
  private active = false;
  private disposed = false;
  private abort: AbortController | null = null;
  private unobserved: string | null;
  private readonly account: Session;
  private readonly commands: DurableCommandClient;
  private waitMs:number;

  constructor(account: Session, commands: DurableCommandClient, waitMs=0) {
    this.waitMs=waitMs;
    this.account = { ...account };
    this.commands = commands;
    // Recover a restored intention before allowing a different action. Even a
    // terminal receipt may have been saved before the old screen saw success.
    this.unobserved = commands.request?.body.command_id ?? null;
  }
  private check(account: Session) {
    if (this.disposed || account.user_id !== this.account.user_id || account.token !== this.account.token) {
      throw Error('Room action session has changed.');
    }
    if (this.active) throw new RoomActionPending();
  }
  private async confirm(): Promise<DurableReceipt> {
    this.active = true;
    const abort = new AbortController(); this.abort = abort;
    try {
      const deadline = Date.now() + this.waitMs;
      const pause = () => new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 200);
        abort.signal.addEventListener('abort', done, {once:true});
        if (abort.signal.aborted) done();
      });
      const reconcile = async () => {
        while (this.commands.reconciling && !abort.signal.aborted) {
          if (Date.now() >= deadline) throw new RoomActionPending();
          await pause();
        }
        return this.commands.reconcile(abort.signal);
      };
      let result = await reconcile();
      while (result?.status === 'pending' && Date.now() < deadline && !abort.signal.aborted) {
        await pause(); result = await reconcile();
      }
      if (this.disposed || abort.signal.aborted) throw Error('Room action session has changed.');
      if (!result || result.status === 'pending') throw new RoomActionPending();
      if (result.status === 'rejected') {
        this.unobserved = null;
        throw new RoomActionRejected(result.outcome?.detail || 'Room action rejected.',result.outcome?.context??undefined);
      }
      return result;
    } finally { this.active = false; this.abort = null; }
  }
  private completed(request: CommandEnvelope, receipt: DurableReceipt): RecoveredRoomAction {
    if (request.body.command === 'create-room') {
      if (!('room_id' in receipt)) throw Error('Missing committed room identity.');
      const input = request.body.payload;
      const room: Room = { room_id: receipt.room_id, name: input.name as string,
        visibility: input.visibility as 'public' | 'private', creator_id: this.account.user_id,
        members: [this.account.user_id] };
      return { command: 'create-room', roomId: room.room_id, room };
    }
    return { command: request.body.command, roomId: request.target.room_id };
  }
  private async run(account: Session, wanted: Intent): Promise<RecoveredRoomAction> {
    this.check(account);
    const saved = this.commands.request;
    if (this.unobserved || this.commands.pending) {
      if (!saved || canonical(intent(saved) as unknown as Json) !== canonical(wanted as unknown as Json)) {
        throw new RoomActionPending();
      }
    } else {
      if (!this.commands.begin(wanted.target, { command: wanted.command, payload: wanted.payload })) {
        throw new RoomActionPending();
      }
    }
    const request = this.commands.request!;
    this.unobserved = request.body.command_id;
    const receipt = await this.confirm();
    const result = this.completed(request, receipt);
    this.unobserved = null;
    return result;
  }
  async recover(account: Session): Promise<RecoveredRoomAction | null> {
    this.check(account);
    if (!this.unobserved && !this.commands.pending) return null;
    const request = this.commands.request;
    if (!request) throw Error('Missing original room action.');
    const result = this.completed(request, await this.confirm());
    this.unobserved = null;
    return result;
  }
  async create(account: Session, input: CreateRoomInput): Promise<Room> {
    const name = input.name.trim();
    if (!name || name.length > 60 || !['public', 'private'].includes(input.visibility)
        || input.invitees.length > 20 || input.invitees.some(id => !id)) throw Error('Invalid room creation fields.');
    const result = await this.run(account, { target: { kind: 'catalog' }, command: 'create-room',
      payload: { name, visibility: input.visibility, invitees: [...input.invitees] } });
    return result.room!;
  }
  private async change(account: Session, roomId: string, command: string): Promise<void> {
    if (!roomId) throw Error('Select a room.');
    await this.run(account, { target: { kind: 'room', room_id: roomId }, command, payload: {} });
  }
  enter(account: Session, roomId: string) { return this.change(account, roomId, 'enter-room'); }
  leave(account: Session, roomId: string) { return this.change(account, roomId, 'leave-room'); }
  remove(account: Session, roomId: string) { return this.change(account, roomId, 'delete-room'); }
  dispose() { this.disposed = true; this.abort?.abort(); }
}
