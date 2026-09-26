// The deployment is part of the persistent identity: identical account IDs on two
// servers must never replay each other's pending commands or share delivery cursors.
export function distributedIdentity(base: string, account: string): string {
  const url = new URL(base);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid server URL.');
  const identity = JSON.stringify([url.href.replace(/\/$/,''), account]);
  if (!account.trim() || identity.length > 128) throw Error('Server/account journal identity exceeds its storage bound.');
  return identity;
}
