import type { Subscription } from './DistributedSession.ts';
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
  constructor(url: string, token: string, clientId: string, onDisconnect: () => void,
    factory: (url: string) => Socket = url => new WebSocket(url)) {
    this.clientId = clientId;
    this.socket = factory(url);
    this.socket.onopen = () => {
      try { this.send({ type: 'AUTH', token, client_id: clientId }); } catch { this.close(); onDisconnect(); }
    };
    this.socket.onclose = this.socket.onerror = () => { this.close(); onDisconnect(); };
    this.socket.onmessage = event => {
      if (this.closed) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 1048576) throw Error('Invalid frame.');
        const data = JSON.parse(event.data);
        if (data.type === 'READY' && !this.ready) {
          this.ready = true; this.lastReply = Date.now();
          for (const [id,e] of this.entries) this.send({type:'SUBSCRIBE',subscription_id:id,lane_id:e.lane});
          return;
        }
        if (data.type === 'PONG') { this.lastReply = Date.now(); return; }
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
      } catch { this.close(); onDisconnect(); }
    };
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastReply > 30000) { this.close(); onDisconnect(); }
      else if (this.ready) try { this.send({type:'PING'}); } catch { this.close(); onDisconnect(); }
    }, 10000);
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
    this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
    for (const id of this.entries.keys()) this.remove(id,true);
    this.socket.close();
  }
}
