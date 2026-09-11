import { useCallback } from 'react';
import { useAudioPlayer } from 'expo-audio';

export function usePong() {
  const player = useAudioPlayer(require('../../assets/pong.wav'));
  const prepare = useCallback(() => {}, []);
  const play = useCallback(() => {
    player.volume = 0.35;
    void player.seekTo(0).then(() => player.play()).catch(() => {});
  }, [player]);
  return { prepare, play };
}
