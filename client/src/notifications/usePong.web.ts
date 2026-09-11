import { useCallback, useEffect, useRef } from 'react';

export function usePong() {
  const context = useRef<AudioContext | null>(null);
  // Resume inside the Collapse / sound-toggle gesture, before notifications arrive.
  const prepare = useCallback(() => {
    try {
      context.current ??= new AudioContext();
      void context.current.resume().catch(() => {});
    } catch { /* Visual notifications still work when audio is unavailable. */ }
  }, []);
  const play = useCallback(() => {
    const audio = context.current;
    if (!audio || audio.state !== 'running') return;
    const tone = audio.createOscillator(), gain = audio.createGain();
    tone.frequency.value = 520;
    gain.gain.setValueAtTime(0, audio.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, audio.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
    tone.connect(gain); gain.connect(audio.destination);
    tone.start(); tone.stop(audio.currentTime + 0.36);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  }, []);
  useEffect(() => () => { void context.current?.close().catch(() => {}); context.current = null; }, []);
  return { prepare, play };
}
