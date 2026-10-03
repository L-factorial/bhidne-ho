import type { Subscription } from './DistributedSession.ts';
export type SocketDisconnect = { cause: 'close' | 'error' | 'heartbeat' | 'protocol' | 'send'; code?: number; reason?: string; wasClean?: boolean };
type Socket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'>;
type Entry = {
  lane: string; ready: boolean; page(value: unknown): void; revoked(): void;
  resolve(value: Subscription): void; reject(error: Error): void; cleanup(): void;
  ack?: { sequence: number; resolve(): void; reject(error: Error): void; cleanup(): void };
};
// One explicit connection per authenticated device session. Recreate on reconnect;
// DistributedSession retains journaled commands and rebuilds streams independently.
export class DistributedSocketTransport {
  private socket: Socket;
  private entries = new Map<string, Entry>();
  private serial = 0;
  private clientId: string;
  private closed = false;
  private ready = false;
  private heartbeat: ReturnType<typeof setInterval>;
  private lastReply = Date.now();
  private probe: {promise: Promise<void>; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>} | null = null;
  private disconnected: (detail?: SocketDisconnect) => void;
  private onReady: () => void;
  get connected() { return this.ready && !this.closed; }
  constructor(url: string, token: string, clientId: string, onDisconnect: (detail?: SocketDisconnect) => void,
    factory: (url: string) => Socket = url => new WebSocket(url), onReady: () => void = () => {}) {
    this.clientId = clientId; this.disconnected = onDisconnect; this.onReady = onReady;
    this.socket = factory(url);
    this.socket.onopen = () => {
      try { this.send({ type: 'AUTH', token, client_id: clientId }); } catch { this.fail({cause:'send'}); }
    };
    this.socket.onclose = event => this.fail({cause:'close',code:event?.code,reason:event?.reason?.slice(0,160),wasClean:event?.wasClean});
    this.socket.onerror = () => this.fail({cause:'error'});
    this.socket.onmessage = event => {
      if (this.closed) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 1048576) throw Error('Invalid frame.');
        const data = JSON.parse(event.data);
        if (data.type === 'READY' && !this.ready) {
          this.ready = true; this.lastReply = Date.now(); this.onReady();
          for (const [id,e] of this.entries) this.send({type:'SUBSCRIBE',subscription_id:id,lane_id:e.lane});
          return;
        }
        if (data.type === 'PONG') {
          this.lastReply = Date.now();
          if(this.probe){const probe=this.probe;this.probe=null;clearTimeout(probe.timer);probe.resolve();}
          return;
        }
        const e = this.entries.get(data.subscription_id);
        if (!e) return; // Late response for a locally closed subscription.
        if (data.type === 'SUBSCRIBED' && !e.ready && data.lane_id === e.lane
            && Number.isSafeInteger(data.cursor) && data.cursor >= 0) {
          e.ready = true;
          e.resolve({ cursor: data.cursor, close: () => this.remove(data.subscription_id),
            acknowledge: (n, signal) => this.acknowledge(data.subscription_id, n, signal) });
        } else if (data.type === 'DELIVERY_PAGE' && e.ready && data.lane_id === e.lane) e.page(data);
        else if (data.type === 'ACKED' && e.ack && data.scanned_sequence === e.ack.sequence
            && Number.isSafeInteger(data.cursor) && data.cursor >= data.scanned_sequence) {
          const ack = e.ack; e.ack = undefined; ack.cleanup(); ack.resolve();
        } else if (data.type === 'STREAM_CLOSED') this.remove(data.subscription_id, true);
        else throw Error('Unexpected delivery response.');
      } catch { this.fail({cause:'protocol'}); }
    };
    this.heartbeat = setInterval(() => {
      if (!this.probe && Date.now() - this.lastReply > 30000) {
        // A suspended app can resume with an overdue interval on a healthy socket.
        if (this.ready) void this.checkHealth().catch(() => {});
        else this.fail({cause:'heartbeat'});
      }
      else if (this.ready) try { this.send({type:'PING'}); } catch { this.fail({cause:'send'}); }
    }, 10000);
  }
  private fail(detail: SocketDisconnect) {
    if(this.closed)return;
    this.close(); this.disconnected(detail);
  }
  // Foregrounding verifies a possibly suspended socket with the existing PING /
  // PONG contract. Concurrent callers share one probe; only timeout replaces it.
  checkHealth(timeoutMs = 10000): Promise<void> {
    if(this.closed)return Promise.reject(Error('Delivery socket closed.'));
    if(!this.ready)return Promise.resolve(); // Initial READY/heartbeat has its own deadline.
    if(this.probe)return this.probe.promise;
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    const timer = setTimeout(()=>this.fail({cause:'heartbeat'}),timeoutMs);
    this.probe={promise,resolve,reject,timer};
    try{this.send({type:'PING'});}catch{this.fail({cause:'send'});}
    return promise;
  }
  private send(value: object) {
    if (this.closed) throw Error('Delivery socket closed.');
    this.socket.send(JSON.stringify(value));
  }
  open(lane: string, _clientId: string, page: (value: unknown) => void, revoked: () => void,
    signal: AbortSignal): Promise<Subscription> {
    if (this.closed || _clientId !== this.clientId || signal.aborted || this.entries.size >= 128) return Promise.reject(Error('Subscription unavailable.'));
    const id = String(++this.serial);
    return new Promise((resolve, reject) => {
      const abort = () => this.remove(id, true);
      const e: Entry = {lane, ready:false, page, revoked, resolve, reject,
        cleanup:()=>signal.removeEventListener('abort',abort)};
      this.entries.set(id,e); signal.addEventListener('abort',abort,{once:true});
      try { if (this.ready) this.send({type:'SUBSCRIBE',subscription_id:id,lane_id:lane}); }
      catch { this.remove(id,true); }
    });
  }
  private acknowledge(id: string, n: number, signal: AbortSignal): Promise<void> {
    const e = this.entries.get(id);
    if (!e?.ready || e.ack || signal.aborted || !Number.isSafeInteger(n) || n < 0) return Promise.reject(Error('ACK unavailable.'));
    return new Promise((resolve,reject) => {
      const abort = () => this.remove(id,true);
      e.ack = {sequence:n,resolve,reject,cleanup:()=>signal.removeEventListener('abort',abort)};
      signal.addEventListener('abort',abort,{once:true});
      try { this.send({type:'ACK',subscription_id:id,scanned_sequence:n}); } catch { this.remove(id,true); }
    });
  }
  private remove(id: string, notify = false) {
    const e = this.entries.get(id); if (!e) return;
    this.entries.delete(id); e.cleanup(); e.ack?.cleanup();
    e.reject(Error('Subscription closed.')); e.ack?.reject(Error('ACK unresolved.'));
    if (!this.closed && this.ready) try { this.send({type:'UNSUBSCRIBE',subscription_id:id}); } catch { /* Connection close recovers. */ }
    if (notify) try { e.revoked(); } catch { /* Continue closing other streams. */ }
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.heartbeat);
    if(this.probe){const probe=this.probe;this.probe=null;clearTimeout(probe.timer);probe.reject(Error('Delivery health check failed.'));}
    this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
    for (const id of this.entries.keys()) this.remove(id,true);
    this.socket.close();
  }
}
