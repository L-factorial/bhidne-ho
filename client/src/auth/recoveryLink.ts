export type RecoveryLink = { purpose: 'verify_email' | 'reset_password'; token: string };
export function readRecoveryLink(value: string): RecoveryLink | null {
  try {
    const url = new URL(value);
    const params = new URLSearchParams(url.hash.slice(1));
    const purpose = params.get('recovery'); const token = params.get('token');
    if ((purpose === 'verify_email' || purpose === 'reset_password') && token && /^[A-Za-z0-9_-]{43}$/.test(token)) return { purpose, token };
  } catch { /* Malformed links are not recovery links. */ }
  return null;
}
