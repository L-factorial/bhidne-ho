import { createContext } from 'react';
export const DeletionNavigation = createContext<() => void>(() => {});
export function deletionLink(url: string): string | null {
  try {
    const value = new URLSearchParams(new URL(url).hash.slice(1)).get('delete_account');
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  } catch { return null; }
}
