import type { GameSnapshot } from './GameCommandClient.ts';
import { captureGamePayload } from './GameCommandClient.ts';
import type { DurableCommandClient, DurableReceipt, Json } from './DurableCommandClient.ts';
import { gameControl } from './DistributedControls.ts';
import type { SelectedTable } from './DistributedControls.ts';

export class GameConfirmationPending extends Error {}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Error('Game refresh aborted.'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},100);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}

// Same submit/refresh interface consumed by the original game controls. The root
// owns the supplied journal slot; disposing a screen cannot discard an action.
export class DistributedGameCommandClient<T extends GameSnapshot> {
  private commands: DurableCommandClient;
  private read: (signal: AbortSignal, invalidate?: boolean) => Promise<T>;
  private selected: (snapshot: T) => SelectedTable;
  private unobserved: string | null;
  private generation = 0;
  private observed: T | null = null;
  observe(snapshot:T) { this.observed=snapshot; }
  constructor(commands: DurableCommandClient, read: (signal: AbortSignal, invalidate?: boolean) => Promise<T>,
    selected: (snapshot: T) => SelectedTable) {
    this.commands = commands; this.read = read; this.selected = selected;
    this.unobserved = commands.request?.body.command_id ?? null;
  }
  get pending() { return this.commands.pending || this.unobserved !== null; }
  submit(snapshot: T, command: string, payload: object = {}) {
    if (this.pending || !snapshot.match_id || !snapshot.game) return false;
    const view = this.selected(snapshot);
    if (view.match_id !== snapshot.match_id || view.game?.revision !== snapshot.game.revision) {
      throw Error('Selected game does not match its committed snapshot.');
    }
    if (!gameControl(this.commands,view,command,captureGamePayload(snapshot,command,payload) as {[key:string]:Json})) return false;
    this.unobserved = this.commands.request!.body.command_id; this.generation++;
    return true;
  }
  async refresh(signal: AbortSignal): Promise<{snapshot:T;error:string}> {
    const generation = this.generation, commandId = this.unobserved;
    // Resolve the captured original command even if the current screen has moved
    // to another table/round. Never resend it against the newly selected game.
    let receipt: DurableReceipt | null = null;
    if (commandId || this.commands.pending) {
      const deadline = Date.now() + 2000;
      let nextCheck=0;
      do {
        // Background recovery owns the same slot. Wait for it rather than
        // starting competing reconciliation or surfacing its normal activity.
        receipt = this.commands.latest;
        if (!this.commands.reconciling && (!receipt || (receipt.status==='pending' && Date.now()>=nextCheck))) {
          receipt = await this.commands.reconcile(signal);nextCheck=Date.now()+1000;
        }
        if (receipt && receipt.status !== 'pending') break;
        await pause(signal);
      } while (Date.now() < deadline);
    }
    if (signal.aborted) throw Error('Game refresh aborted.');
    if ((commandId || this.commands.pending) && (!receipt || receipt.status === 'pending')) {
      throw new GameConfirmationPending('Waiting for the server to confirm your action.');
    }
    const revision=receipt && 'outcome' in receipt ? receipt.outcome?.revision : null;
    const snapshot = receipt?.status==='accepted' && revision!=null && this.observed?.match_id===this.commands.request?.body.match_id
      && (this.observed?.game?.revision ?? -1)>=revision ? this.observed! : await this.read(signal,!!commandId || this.commands.pending);
    if (signal.aborted) throw Error('Game refresh aborted.');
    if (generation !== this.generation) throw Error('Game changed during refresh.');
    // Keep the result unobserved until a fresh projection succeeds. A failed read
    // after acceptance therefore retries only the read, never the game action.
    this.unobserved = null;
    return {snapshot,error:receipt?.status === 'rejected'
      ? receipt.outcome?.detail || 'Action rejected.' : ''};
  }
}
