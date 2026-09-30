// Match the server's conservative ASCII mailbox format. Verification, not format
// validation, establishes mailbox ownership; do not rewrite provider aliases.
export function validSignupEmail(value: string): boolean {
  const email = value.trim();
  if (email.length > 254 || /[^\x21-\x7E]/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  const labels = domain.split('.');
  return local.length >= 1 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.')
    && !local.includes('..') && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    && labels.length >= 2
    && labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
