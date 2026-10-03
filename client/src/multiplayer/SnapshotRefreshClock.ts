// Only successful authoritative reads advance this clock. Scopes use the
// room and match identity, so another table/rematch cannot postpone this poll.
export class SnapshotRefreshClock {
  private refreshed = new Map<string, number>();
  private intervalMs: number;
  private now: () => number;
  constructor(intervalMs = 30000, now: () => number = Date.now) {this.intervalMs=intervalMs;this.now=now;}
  private key(room: string, match: string) { return JSON.stringify([room,match]); }
  success(room: string, match: string) {
    const key=this.key(room,match);this.refreshed.delete(key);this.refreshed.set(key,this.now());
    if(this.refreshed.size>128)this.refreshed.delete(this.refreshed.keys().next().value!);
  }
  delay(room: string, match: string | undefined, pending = false, failed = false) {
    if(pending || failed)return 1000;
    const last=match ? this.refreshed.get(this.key(room,match)) : undefined;
    return last===undefined ? (match ? 0 : this.intervalMs) : Math.max(0,this.intervalMs-(this.now()-last));
  }
}
