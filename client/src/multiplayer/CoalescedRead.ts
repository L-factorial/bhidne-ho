// Calls queued before a read starts share it. Invalidations arriving during an
// in-flight read wait for a NEW read, so a later commit can never be missed.
type Waiter<T> = {signal:AbortSignal;resolve:(v:T)=>void;reject:(e:unknown)=>void};
export class CoalescedRead<T> {
  private queued: Waiter<T>[] = [];
  private running = false;
  private active: {batch: Waiter<T>[]; controller: AbortController; cancel(): void} | null = null;
  private read: (signal:AbortSignal)=>Promise<T>;
  constructor(read: (signal:AbortSignal)=>Promise<T>) {this.read=read;}
  load(signal:AbortSignal, invalidate = true):Promise<T> {
    return new Promise((resolve,reject)=>{
      if(signal.aborted){reject(Error('Snapshot read cancelled.'));return;}
      const waiter={signal,resolve,reject};
      // A fallback poll can join an in-flight read. An actual notification must
      // wait for a newer read if this request began before the notified commit.
      if(!invalidate && this.active && !this.queued.length && !this.active.controller.signal.aborted){
        this.active.batch.push(waiter);signal.addEventListener('abort',this.active.cancel,{once:true});return;
      }
      this.queued.push(waiter);
      if(!this.running){this.running=true;setTimeout(()=>void this.drain(),20);}
    });
  }
  private async drain() {
    const batch=this.queued.splice(0), controller=new AbortController();
    const cancel=()=>{if(batch.every(w=>w.signal.aborted))controller.abort();};
    this.active={batch,controller,cancel};
    for(const w of batch)w.signal.addEventListener('abort',cancel,{once:true});cancel();
    try {
      if(controller.signal.aborted)throw Error('Snapshot read cancelled.');
      const value=await this.read(controller.signal);
      for(const w of batch)w.signal.aborted?w.reject(Error('Snapshot read cancelled.')):w.resolve(value);
    } catch(error){for(const w of batch)w.reject(error);}
    finally {
      this.active=null;
      for(const w of batch)w.signal.removeEventListener('abort',cancel);
      if(this.queued.length)setTimeout(()=>void this.drain(),20);else this.running=false;
    }
  }
}
