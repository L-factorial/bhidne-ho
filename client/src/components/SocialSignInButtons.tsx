import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { startSocialLogin, type SocialProvider } from '../auth/social';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { useTheme } from '../theme';
import { SignInButton } from './SignInButton';

export function SocialSignInButtons({ onSession, disabled = false, onBusyChange }: {
  onSession: (session: Session) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const { colors } = useTheme();
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void request<{ providers: SocialProvider[] }>('/auth/social/browser/providers', null, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setProviders(value.providers || []); })
      .catch(() => {}); // Password sign-in remains usable when discovery is unavailable.
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  async function signIn(provider: SocialProvider) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(provider); setError(''); onBusyChange?.(true);
    try {
      const session = await startSocialLogin(provider);
      if (session && mounted.current) onSession(session);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not sign in. Please try again.');
    } finally {
      pending.current = false; onBusyChange?.(false);
      if (mounted.current) setBusy(null);
    }
  }
  const labels = { google: 'Google', apple: 'Apple', facebook: 'Facebook' } as const;
  if (!providers.length) return null;
  return <View style={{ gap: 12 }}>
    {(['google', 'apple', 'facebook'] as const).filter(provider => providers.includes(provider)).map(provider =>
      <SignInButton key={provider} method={labels[provider]} disabled={disabled || busy !== null}
        label={busy === provider ? `Signing in with ${labels[provider]}…` : undefined} onPress={() => void signIn(provider)} />)}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
  </View>;
}
