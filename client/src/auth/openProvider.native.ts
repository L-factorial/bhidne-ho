import * as WebBrowser from 'expo-web-browser';

export function returnUri() { return 'bhidneho://auth'; }
export async function openProvider(url: string): Promise<string | null> {
  const result = await WebBrowser.openAuthSessionAsync(url, returnUri());
  return result.type === 'success' ? result.url : null;
}
