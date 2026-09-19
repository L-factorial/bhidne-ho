export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type Socket = Pick<WebSocket, 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'>;

// Transport only: no game commands, seats, hands, or game-specific state.
export class RoomConnection {
  private socket: Socket | null = null;
  private ready = false;
  send(message: object) {
    if (!this.ready || !this.socket || this.stopped) return false;
    try { this.socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private attempts = 0;
  private hasConnected = false;
  private url: string;
  private onStatus: (status: ConnectionStatus) => void;
  private makeSocket: (url: string) => Socket;
  private onEvent: (message: unknown) => void;

  constructor(url: string, onStatus: (status: ConnectionStatus) => void,
    makeSocket: (url: string) => Socket = url => new WebSocket(url),
    onEvent: (message: unknown) => void = () => {}) {
    this.url = url; this.onStatus = onStatus; this.makeSocket = makeSocket;
    this.onEvent = onEvent;
  }
  start() { this.stopped = false; this.connect(); }
  stop() {
    this.stopped = true; this.disposeSocket();
  }
  retryNow() {
    if (!this.stopped) { this.disposeSocket(); this.connect(); }
  }
  private disposeSocket() {
    this.ready = false;
    clearTimeout(this.timer);
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(); }
  }
  private reconnect = () => {
    if (this.stopped) return;
    this.disposeSocket(); this.onStatus('reconnecting');
    this.timer = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.attempts++, 8000));
  };
  private connect() {
    if (this.stopped) return;
    this.onStatus(this.attempts ? 'reconnecting' : 'connecting');
    let socket: Socket;
    try { socket = this.makeSocket(this.hasConnected && !new URL(this.url).searchParams.has('resume') ? `${this.url}${this.url.includes('?') ? '&' : '?'}resume=1` : this.url); } catch { this.reconnect(); return; }
    this.socket = socket;
    this.timer = setTimeout(this.reconnect, 10000);
    socket.onclose = socket.onerror = () => { if (this.socket === socket) this.reconnect(); };
    socket.onmessage = event => {
      if (this.socket !== socket || this.stopped) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ROOM_LEFT') {
        this.stop(); this.onStatus('disconnected'); this.onEvent(message); return;
      }
      if (message.type === 'CONNECTED') {
        this.ready = true; this.hasConnected = true; this.attempts = 0; this.onStatus('connected'); this.scheduleHeartbeat(socket);
      } else if (message.type === 'HEARTBEAT_ACK') this.scheduleHeartbeat(socket);
      else this.onEvent(message);
    };
  }
  private scheduleHeartbeat(socket: Socket) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.socket !== socket || this.stopped) return;
      this.timer = setTimeout(this.reconnect, 10000);
      try { socket.send(JSON.stringify({ type: 'HEARTBEAT' })); } catch { this.reconnect(); }
    }, 5000);
  }
}
