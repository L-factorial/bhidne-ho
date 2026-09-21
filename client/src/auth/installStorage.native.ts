import * as SecureStore from 'expo-secure-store';
import { configureAuthStorage } from './storage.ts';

const nativeKey = (key: string) => 'bhidne.' + Array.from(key).map(char => char.codePointAt(0)!.toString(16)).join('_');
configureAuthStorage({
  read: key => SecureStore.getItem(nativeKey(key)) || null,
  // Synchronous overwrite prevents a delayed deletion racing a new login.
  write: (key, value) => SecureStore.setItem(nativeKey(key), value || '', {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
});
