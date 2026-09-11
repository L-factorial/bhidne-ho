import { Platform } from 'react-native';
import type { Session } from './session';

export const apiUrl = (process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'web'
  ? `${globalThis.location.protocol}//${globalThis.location.hostname}:8000` : 'http://127.0.0.1:8000')).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function request<T>(path: string, session: Session | null, body?: object, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: body ? 'POST' : 'GET', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new ApiError(response.status, response.status === 401
      ? 'Session expired. The server may have restarted. Sign out to start a new session.'
      : typeof data.detail === 'string' ? data.detail : 'Could not complete this request.');
    return data;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
