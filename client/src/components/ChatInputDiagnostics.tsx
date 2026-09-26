import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

// Explicit, local-only troubleshooting. Never read values, messages, URLs, or identities.
export function ChatInputDiagnostics() {
  const enabled = Platform.OS === 'web' && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('chatDebug') === '1';
  return enabled ? <Recorder /> : null;
}

function describe(target: EventTarget | null): string {
  if (!(target instanceof Element)) return 'none';
  if (target.matches('[data-testid="table-chat-composer"] textarea, [data-testid="table-chat-composer"] input')) return 'chat-input';
  if (target.closest('[data-testid="chat-input-diagnostics"]')) return 'diagnostics';
  return target.tagName.toLowerCase();
}

function Recorder() {
  const entries = useRef<object[]>([]);
  const [report, setReport] = useState('');
  const [status, setStatus] = useState('Copy diagnostics');
  useEffect(() => {
    let live = true;
    const started = performance.now();
    const record = (event?: Event) => {
      const target = describe(event?.target ?? null);
      if (target === 'diagnostics') return;
      const activeAtCapture = describe(document.activeElement);
      const touch = typeof TouchEvent !== 'undefined' && event instanceof TouchEvent ? event.changedTouches[0] : undefined;
      const point = touch ?? (event instanceof MouseEvent ? event : undefined);
      const hit = point ? document.elementsFromPoint(point.clientX, point.clientY).slice(0, 4).map(describe) : [];
      // Observe after dispatch without interfering with focus or gesture handling.
      queueMicrotask(() => {
        if (!live) return;
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="table-chat-composer"] textarea, [data-testid="table-chat-composer"] input');
        const css = input ? getComputedStyle(input) : null;
        const viewport = window.visualViewport;
        entries.current = [...entries.current.slice(-19), {
          ms: Math.round(performance.now() - started), event: event?.type ?? 'opened', target, hit,
          prevented: event?.defaultPrevented ?? false, activeAtCapture, active: describe(document.activeElement),
          input: input ? { focused: document.activeElement === input, disabled: input.disabled,
            readOnly: input.readOnly, inputMode: input.inputMode, connected: input.isConnected,
            pointerEvents: css?.pointerEvents, visibility: css?.visibility,
            inert: !!input.closest('[inert]') } : null,
          dialogs: document.querySelectorAll('dialog[open]').length,
          viewport: { height: Math.round(viewport?.height ?? window.innerHeight),
            top: Math.round(viewport?.offsetTop ?? 0), scale: viewport?.scale ?? 1 },
        }];
      });
    };
    const events = ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'focusin', 'focusout', 'input'];
    events.forEach(name => document.addEventListener(name, record, { capture: true, passive: true }));
    window.visualViewport?.addEventListener('resize', record);
    record();
    return () => {
      live = false;
      events.forEach(name => document.removeEventListener(name, record, true));
      window.visualViewport?.removeEventListener('resize', record);
    };
  }, []);
  return <View testID="chat-input-diagnostics" style={{ padding: 6, backgroundColor: '#f0f4fa', borderRadius: 8 }}>
    <Text style={{ color: '#152238', fontSize: 12 }}>Chat diagnostics: tap the message field, then copy this report. No message text is recorded.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Copy chat diagnostics" onPress={async () => {
      const snapshot = JSON.stringify({ version: 1, events: entries.current }, null, 2);
      setReport(snapshot);
      try { await navigator.clipboard.writeText(snapshot); setStatus('Copied'); }
      catch { setStatus('Copy unavailable; select the report below'); }
    }} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: '#152238' }}>{status}</Text>
    </Pressable>
    <Text testID="chat-input-diagnostics-report" selectable numberOfLines={2} style={{ color: '#152238', fontSize: 10 }}>{report}</Text>
  </View>;
}
