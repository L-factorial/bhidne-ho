export function returnUri() { return globalThis.location.origin + globalThis.location.pathname; }
export async function openProvider(url: string): Promise<string | null> {
  globalThis.location.assign(url);
  return null;
}
