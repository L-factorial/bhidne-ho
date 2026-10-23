import {diagnostic, nextRequestId} from '../diagnostics/events';
import { runtimeRequest, sharedPlatformPath } from './RuntimeRequests';
import { Platform } from 'react-native';
import type { Session } from './session';
import { decodeApiResponse } from './apiResponse';
export { ApiError } from './apiResponse';

export const apiUrl = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web'
    ? (['8081', '8083'].includes(globalThis.location.port)
      ? `${globalThis.location.protocol}//${globalThis.location.hostname}:8000`
      : globalThis.location.origin)
    : 'https://api-bhidne-ho.lfactorial.com')
).replace(/\/$/, '');

export async function sharedRequest<T>(path: string, session: Session | null, body?: object, signal?: AbortSignal, method?: 'DELETE' | 'PATCH'): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; abort(); }, 10000);
  const requestId = nextRequestId(), started = Date.now();
  const operation = body && /\/messages(?:\?|$)/.test(path) ? 'message.send' as const : 'request' as const;
  const verb = method || (body ? 'POST' : 'GET');
  let status: number | undefined;
  diagnostic('request.started', {requestId, operation, method: verb});
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: method || (body ? 'POST' : 'GET'), signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = response.status === 204 ? '' : await response.text();
    status = response.status;
    const result = decodeApiResponse<T>(raw, response.status, path === '/auth/signin');
    diagnostic('request.succeeded', {requestId, operation, status, durationMs: Date.now() - started});
    return result;
  } catch (error) {
    diagnostic('request.failed', {requestId, operation, status, durationMs: Date.now() - started,
      reason: timedOut ? 'timeout' : signal?.aborted ? 'cancelled' : 'failure'}, signal?.aborted && !timedOut ? 'info' : 'warn');
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export async function request<T>(path: string, session: Session | null, body?: object, signal?: AbortSignal, method?: 'DELETE' | 'PATCH'): Promise<T> {
  const adapter = runtimeRequest(session);
  if (adapter) return adapter<T>(path, session, body, signal, method);
  if (process.env.EXPO_PUBLIC_RUNTIME_MODE === 'distributed-original' && !sharedPlatformPath(path, body, method)) {
    throw Error('Preparing the distributed session. Please retry in a moment.');
  }
  return sharedRequest<T>(path, session, body, signal, method);
}
