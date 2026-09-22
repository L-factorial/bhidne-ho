import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { apiUrl } from './api';

export function useRecentRooms(userId?: string, roomId?: string) {
  const [saved, setSaved] = useState<{ userId: string; ids: string[] }>({ userId: '', ids: [] });
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const key = `bhidne.recent-rooms:${apiUrl}:${userId}`;
    void (async () => {
      let ids: string[] = [];
      try {
        const value: unknown = JSON.parse(await AsyncStorage.getItem(key) || '[]');
        if (Array.isArray(value)) ids = value.filter((id): id is string => typeof id === 'string').slice(0, 30);
      } catch { /* Device history is optional. */ }
      if (!active) return;
      if (roomId) ids = [roomId, ...ids.filter(id => id !== roomId)].slice(0, 30);
      setSaved({ userId, ids });
      if (roomId) await AsyncStorage.setItem(key, JSON.stringify(ids)).catch(() => {});
    })();
    return () => { active = false; };
  }, [userId, roomId]);
  return saved.userId === userId ? saved.ids : [];
}
