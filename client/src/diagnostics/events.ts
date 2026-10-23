/** Bounded, memory-only diagnostics. Never accept payloads, URLs or error text. */
export type DiagnosticEvent = 'request.started'|'request.succeeded'|'request.failed'|'app.started'|'app.state'|'app.transition'|'app.unhandled_error'|'app.unhandled_rejection'|'socket.connecting'|'socket.ready'|'socket.disconnected';
type Details = {operation?: 'request'|'message.send'; requestId?: number; method?: string; status?: number; durationMs?: number; reason?: 'timeout'|'cancelled'|'failure'|'close'|'error'|'heartbeat'|'protocol'|'send'; fatal?: boolean; state?: string; screen?: string; tab?: string; code?: number};
export type DiagnosticEntry = {time: number; level: 'info'|'warn'|'error'; event: DiagnosticEvent; details: Details};
const capacity = 300;
const entries: DiagnosticEntry[] = [];
let serial = 0;
export function nextRequestId() { return ++serial; }
export function diagnostic(event: DiagnosticEvent, details: Details = {}, level: DiagnosticEntry['level'] = 'info') {
  // Explicit scalar allowlist prevents accidental payload/header/error serialization.
  const clean: Details = {};
  for (const key of ['operation','requestId','method','status','durationMs','reason','fatal','state','screen','tab','code'] as const) {
    const value = details[key];
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' && value.length <= 64) Object.assign(clean, {[key]: value});
  }
  const entry = {time: Date.now(), level, event, details: clean};
  entries.push(entry);
  if (entries.length > capacity) entries.shift();
  // Successful polling remains in the buffer without flooding production consoles.
  try { if (level !== 'info' || (globalThis as {__DEV__?: boolean}).__DEV__) console[level]('[diagnostic]', entry); } catch { /* Logging must never break the app. */ }
}
export function recentDiagnostics(): DiagnosticEntry[] { return entries.map(entry => ({...entry, details: {...entry.details}})); }
export function clearDiagnostics() { entries.length = 0; }
