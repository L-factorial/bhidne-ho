import type { DistributedSession } from './DistributedSession.ts';
import type { CommandBody, CommandEnvelope, CommandTarget, DurableReceipt } from './DurableCommandClient.ts';
import { GameRequestError } from './PendingGameAction.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value !== null && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
const intention = (r: CommandEnvelope) => ({target:r.target,command:r.body.command,match_id:r.body.match_id??null,payload:r.body.payload});
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Error('Action wait cancelled.'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},200);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
// Screen requests use a bounded set of root-owned slots. Ambiguous outcomes keep
// their original target, payload, revision and ID, even after the screen unmounts.
export class DistributedUiIntent {
  private active = new Set<string>();
  private session: Pick<DistributedSession<unknown>,'command'|'releaseCommand'>;
  constructor(session: Pick<DistributedSession<unknown>,'command'|'releaseCommand'>) { this.session=session; }
  async run<T>(slot: string,target: CommandTarget,body: Omit<CommandBody,'command_id'>,
    signal: AbortSignal, finish: (receipt:DurableReceipt,request:CommandEnvelope)=>Promise<T>): Promise<T> {
    if (this.active.has(slot)) throw Error('This action is already being confirmed.');
    if(signal.aborted)throw Error('Action cancelled.');
    this.active.add(slot);
    try {
      const command=this.session.command(slot), saved=command.request;
      if(saved) {
        const wanted={target,body:{...body,command_id:saved.body.command_id}};
        if(canonical(intention(saved))!==canonical(intention(wanted))) {
          throw Error('Confirm the previous action before starting a different one.');
        }
      } else if(!command.begin(target,body))throw Error('Action already pending.');
      const deadline=Date.now()+30000;
      const reconcile=async()=>{
        while(command.reconciling){await delay(signal);if(Date.now()>=deadline)throw Error('Waiting for confirmation. Retry to check the original action.');}
        return command.reconcile(signal);
      };
      let receipt=await reconcile();
      while(receipt?.status==='pending'&&Date.now()<deadline) {
        await delay(signal);receipt=await reconcile();
      }
      if(signal.aborted)throw Error('Action cancelled.');
      if(!receipt||receipt.status==='pending')throw Error('Waiting for confirmation. Retry to check the original action.');
      if(receipt.status==='rejected') {
        this.session.releaseCommand(slot);
        throw new GameRequestError(409,receipt.outcome?.detail||'Action rejected.',receipt.outcome?.context??undefined);
      }
      const result=await finish(receipt,command.request!);
      if(signal.aborted)throw Error('Action cancelled.');
      this.session.releaseCommand(slot);
      return result;
    } finally {this.active.delete(slot);}
  }
}
