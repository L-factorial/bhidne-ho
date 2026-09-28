import type { GameSnapshot } from './GameCommandClient.ts';
import type { DurableCommandClient, Json } from './DurableCommandClient.ts';
import { gameControl } from './DistributedControls.ts';
import type { SelectedTable } from './DistributedControls.ts';

// Same submit/refresh interface consumed by the original game controls. The root
// owns the supplied journal slot; disposing a screen cannot discard an action.
export class DistributedGameCommandClient<T extends GameSnapshot> {
  private commands: DurableCommandClient;
  private read: (signal: AbortSignal) => Promise<T>;
  private selected: (snapshot: T) => SelectedTable;
  private unobserved: string | null;
  private generation = 0;
  constructor(commands: DurableCommandClient, read: (signal: AbortSignal) => Promise<T>,
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
    if (!gameControl(this.commands,view,command,payload as {[key:string]:Json})) return false;
    this.unobserved = this.commands.request!.body.command_id; this.generation++;
    return true;
  }
  async refresh(signal: AbortSignal): Promise<{snapshot:T;error:string}> {
    const generation = this.generation, commandId = this.unobserved;
    // Resolve the captured original command even if the current screen has moved
    // to another table/round. Never resend it against the newly selected game.
    const receipt = commandId || this.commands.pending ? await this.commands.reconcile(signal) : null;
    if (signal.aborted) throw Error('Game refresh aborted.');
    if ((commandId || this.commands.pending) && (!receipt || receipt.status === 'pending')) {
      throw Error('Waiting for the server to confirm your action.');
    }
    const snapshot = await this.read(signal);
    if (signal.aborted) throw Error('Game refresh aborted.');
    if (generation !== this.generation) throw Error('Game changed during refresh.');
    // Keep the result unobserved until a fresh projection succeeds. A failed read
    // after acceptance therefore retries only the read, never the game action.
    this.unobserved = null;
    return {snapshot,error:receipt?.status === 'rejected'
      ? receipt.outcome?.detail || 'Action rejected.' : ''};
  }
}
