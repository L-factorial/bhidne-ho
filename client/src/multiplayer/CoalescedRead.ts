// Calls queued before a read starts share it. Invalidations arriving during an
// in-flight read wait for a NEW read, so a later commit can never be missed.
export class CoalescedRead<T> {
  private queued: {signal:AbortSignal;resolve:(v:T)=>void;reject:(e:unknown)=>void}[] = [];
  private running = false;
  private read: (signal:AbortSignal)=>Promise<T>;
  constructor(read: (signal:AbortSignal)=>Promise<T>) {this.read=read;}
  load(signal:AbortSignal):Promise<T> {
    return new Promise((resolve,reject)=>{
      this.queued.push({signal,resolve,reject});
      if(!this.running){this.running=true;setTimeout(()=>void this.drain(),20);}
    });
  }
  private async drain() {
    const batch=this.queued.splice(0), controller=new AbortController();
    const cancel=()=>{if(batch.every(w=>w.signal.aborted))controller.abort();};
    for(const w of batch)w.signal.addEventListener('abort',cancel,{once:true});cancel();
    try {
      if(controller.signal.aborted)throw Error('Snapshot read cancelled.');
      const value=await this.read(controller.signal);
      for(const w of batch)w.signal.aborted?w.reject(Error('Snapshot read cancelled.')):w.resolve(value);
    } catch(error){for(const w of batch)w.reject(error);}
    finally {
      for(const w of batch)w.signal.removeEventListener('abort',cancel);
      if(this.queued.length)setTimeout(()=>void this.drain(),20);else this.running=false;
    }
  }
}
