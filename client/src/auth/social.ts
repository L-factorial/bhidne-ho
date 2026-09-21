import { Platform } from 'react-native';
import { apiUrl, request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { openProvider, returnUri } from './openProvider';
import { readAuthValue, writeAuthValue } from './storage.ts';

export type SocialProvider = 'google' | 'apple' | 'facebook';
type PendingLogin = { attempt_id: string; secret: string; returnUri: string; originalUrl?: string; expiresAt: number };
const pendingKey = `bhidne.social.v1:${apiUrl}`;
let starting = false;
let completion: Promise<Session> | null = null;

export function isSocialReturn(url: string) {
  try { return new URL(url).searchParams.has('social_attempt'); } catch { return false; }
}

export async function startSocialLogin(provider: SocialProvider): Promise<Session | null> {
  if (starting) return null;
  starting = true;
  try {
    const redirect_uri = returnUri();
    const value = await request<{ attempt_id: string; secret: string; authorization_url: string }>(
      `/auth/social/browser/${provider}/start`, null, { redirect_uri });
    writeAuthValue(pendingKey, JSON.stringify({ attempt_id: value.attempt_id, secret: value.secret,
      returnUri: redirect_uri, expiresAt: Date.now() + 600000,
      ...(Platform.OS === 'web' ? { originalUrl: globalThis.location.href } : {}),
    } satisfies PendingLogin));
    const callback = await openProvider(value.authorization_url);
    if (callback) return await completeSocialLogin(callback);
    if (Platform.OS !== 'web') writeAuthValue(pendingKey, null);
    return null;
  } finally { starting = false; }
}

export function completeSocialLogin(url: string): Promise<Session> {
  // React effects and native callbacks can both observe the same return.
  if (completion) return completion;
  completion = finish(url).finally(() => { completion = null; });
  return completion;
}

async function finish(url: string): Promise<Session> {
  const raw = readAuthValue(pendingKey);
  const pending: PendingLogin | null = raw ? JSON.parse(raw) : null;
  const callback = new URL(url);
  if (!pending || pending.expiresAt < Date.now() || callback.searchParams.get('social_attempt') !== pending.attempt_id
    || !callback.searchParams.get('social_code')
    || callback.protocol + '//' + callback.host + callback.pathname !== pending.returnUri) {
    throw new Error('This sign-in did not start in this app session or has expired. Please try again.');
  }
  try {
    return await request<Session>('/auth/social/browser/complete', null, {
      attempt_id: pending.attempt_id, secret: pending.secret, handoff: callback.searchParams.get('social_code'),
    });
  } finally {
    writeAuthValue(pendingKey, null);
    if (Platform.OS === 'web') {
      // Restore invitation parameters without accepting an arbitrary callback destination.
      const original = new URL(pending.originalUrl || pending.returnUri);
      if (original.origin === globalThis.location.origin) globalThis.history.replaceState(null, '', original.href);
    }
  }
}
