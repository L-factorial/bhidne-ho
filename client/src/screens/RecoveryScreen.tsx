import {AppText as Text} from '../components/AppText';
import { RoomSheet } from '../components/RoomSheet';
import { AccountPage, accountStyles } from '../components/AccountPage';
import { useEffect, useRef, useState } from 'react';
import {Modal, Pressable, View, type TextInput} from 'react-native';
import { FormInput } from '../components/FormInput';
import { sharedRequest, ApiError } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import type { RecoveryLink } from '../auth/recoveryLink';
import { validSignupEmail } from '../auth/email';
import { fonts, useTheme } from '../theme';
import { ui } from '../i18n/copy';
import type { UiKey } from '../i18n/catalogs';
import { useUiLanguage } from '../i18n/useUiLanguage';

function recoveryError(error: unknown) {
  const code = error instanceof ApiError ? error.detail?.code : undefined;
  return ui((['recovery_unavailable','recovery_rate_limited','recovery_password_incorrect','recovery_link_invalid'].includes(String(code))
    ? `recovery.${code}` : 'recovery.failure') as UiKey);
}
function Action({ label, onPress, disabled = false, primary = false }: {label: string; onPress: () => void; disabled?: boolean; primary?: boolean}) {
  const { colors } = useTheme(); const styles = accountStyles(colors);
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, primary && {backgroundColor:colors.primary}, disabled && {opacity:.5}]}>
    <Text style={[styles.buttonText, primary && {color:colors.onPrimary}]}>{label}</Text>
  </Pressable>;
}
export function RecoveryScreen({ link, onDone, recoverUsername = false }: {link?: RecoveryLink; onDone: (reset: boolean) => void; recoverUsername?: boolean}) {
  useUiLanguage();
  const { colors } = useTheme(); const styles = accountStyles(colors);
  const [username, setUsername] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null); const confirmRef = useRef<TextInput>(null);
  useEffect(() => { let active = true; void sharedRequest<{enabled: boolean}>('/auth/recovery/capabilities', null)
    .then(v => { if (active) setEnabled(v.enabled); }).catch(() => { if (active) setEnabled(false); }); return () => { active = false; }; }, []);
  const verify = link?.purpose === 'verify_email'; const reset = link?.purpose === 'reset_password';
  const disabled = busy || !enabled || (reset ? password.length < 8 || password.length > 128 || password !== confirmation : !verify && (recoverUsername ? !validSignupEmail(email) : !username.trim()));
  async function submit() {
    if (disabled) return;
    setBusy(true); setError('');
    try {
      await sharedRequest(verify ? '/auth/recovery/verify' : reset ? '/auth/recovery/reset/complete' : recoverUsername ? '/auth/recovery/username/request' : '/auth/recovery/reset/request', null,
        verify ? {token: link!.token} : reset ? {token: link!.token, password} : recoverUsername ? {email: email.trim()} : {username: username.trim()});
      setPassword(''); setConfirmation(''); setDone(true);
    } catch (e) { setError(recoveryError(e)); } finally { setBusy(false); }
  }
  const inputStyle = styles.input;
  return <AccountPage footer={<>
      {!done && <Action primary label={ui(verify ? 'recovery.verify' : reset ? 'recovery.reset' : recoverUsername ? 'recovery.sendUsername' : 'recovery.request')} onPress={() => void submit()} disabled={disabled}/>}
      <Action label={ui(done && reset ? 'recovery.done' : 'recovery.back')} disabled={busy} onPress={() => onDone(done && reset)}/>
    </>}>
      <Text accessibilityRole="header" style={styles.title}>{ui(verify ? 'recovery.verify' : reset ? 'recovery.reset' : recoverUsername ? 'recovery.forgotUsername' : 'recovery.title')}</Text>
      <Text style={styles.description}>{ui(done ? (verify ? 'recovery.verified' : reset ? 'recovery.resetDone' : recoverUsername ? 'recovery.usernameRequested' : 'recovery.requested') : (verify ? 'recovery.verifyHelp' : reset ? 'recovery.resetHelp' : recoverUsername ? 'recovery.usernameHelp' : 'recovery.requestHelp'))}</Text>
      {!done && <>
        {enabled === null && <Text style={{color:colors.text}}>{ui('recovery.loading')}</Text>}
        {enabled === false && <Text accessibilityRole="alert" style={{color:colors.text}}>{ui('recovery.unavailable')}</Text>}
        {!link && !recoverUsername && <FormInput accessibilityLabel={ui('common.username')} placeholder={ui('common.username')} value={username} onChangeText={setUsername} maxLength={64} autoCapitalize="none" autoCorrect={false} editable={!busy} style={inputStyle} returnKeyType="send" onSubmitEditing={() => void submit()} />}
        {!link && recoverUsername && <FormInput accessibilityLabel={ui('common.email')} placeholder={ui('common.email')} value={email} onChangeText={setEmail} maxLength={254} keyboardType="email-address" textContentType="emailAddress" autoCapitalize="none" autoCorrect={false} editable={!busy} style={inputStyle} returnKeyType="send" onSubmitEditing={() => void submit()} />}
        {reset && <>
          <FormInput accessibilityLabel={ui('recovery.newPassword')} placeholder={ui('recovery.newPassword')} value={password} onChangeText={setPassword} maxLength={128} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" editable={!busy} style={inputStyle} returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} />
          <FormInput ref={confirmRef} accessibilityLabel={ui('common.confirm_password')} placeholder={ui('common.confirm_password')} value={confirmation} onChangeText={setConfirmation} maxLength={128} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} style={inputStyle} returnKeyType="done" onSubmitEditing={() => void submit()} />
          {!!confirmation && password !== confirmation && <Text accessibilityRole="alert" style={{color:colors.danger}}>{ui('common.passwords_do_not_match')}</Text>}
        </>}
      </>}
      {!!error && <Text accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}
  </AccountPage>;
}
export function ForgotPassword() {
  const [mode, setMode] = useState<'password' | 'username' | null>(null);
  const [choices, setChoices] = useState(false);
  const { colors } = useTheme(); useUiLanguage();
  const choose = (value: 'password' | 'username') => { setChoices(false); setMode(value); };
  return <>
    <Pressable accessibilityRole="button" onPress={() => setChoices(true)} style={{minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start'}}>
      <Text style={{fontFamily: fonts.medium, fontSize: 13, color: colors.accent, textDecorationLine: 'underline'}}>{ui('common.forgot_username_password')}</Text>
    </Pressable>
    {choices && <RoomSheet visible title={ui('common.recovery_choices')} onClose={() => setChoices(false)}>
      <Action label={ui('common.recover_username_choice')} onPress={() => choose('username')} />
      <Action label={ui('common.recover_password_choice')} onPress={() => choose('password')} />
    </RoomSheet>}
    <Modal visible={mode !== null} animationType="slide" onRequestClose={() => setMode(null)}>{mode && <RecoveryScreen key={mode} recoverUsername={mode === 'username'} onDone={() => setMode(null)}/>}</Modal>
  </>;
}

type EmailStatus = {enabled: boolean; password_account: boolean; verified_email: string | null; pending_email: string | null};
export function RecoveryEmailSettings({session}: {session: Session}) {
  useUiLanguage(); const { colors } = useTheme();
  const [status, setStatus] = useState<EmailStatus | null>(null); const [email,setEmail] = useState(''); const [password,setPassword] = useState('');
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [message,setMessage] = useState(''); const [removing,setRemoving] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  useEffect(() => { const controller = new AbortController(); void sharedRequest<EmailStatus>('/auth/recovery/email',session,undefined,controller.signal)
    .then(v => {setStatus(v); setEmail(v.pending_email || v.verified_email || '');}).catch(e => {if(!controller.signal.aborted)setError(recoveryError(e));}); return () => controller.abort(); }, [session.token]);
  async function save(remove = false) {
    if (busy || !password || !status?.enabled || (!remove && !validSignupEmail(email))) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await sharedRequest('/auth/recovery/email',session,{current_password:password,...(!remove ? {email:email.trim()} : {})},undefined,remove?'DELETE':undefined);
      setPassword(''); setRemoving(false); setMessage(ui(remove?'recovery.removed':'recovery.sent'));
      if(remove)setEmail('');
      setStatus(await sharedRequest<EmailStatus>('/auth/recovery/email',session));
    } catch(e) {setError(recoveryError(e));} finally {setBusy(false);}
  }
  const inputStyle=accountStyles(colors).input;
  return <View testID="recovery-email-settings" style={{gap:12}}>
    <Text accessibilityRole="header" style={{fontSize:20,color:colors.text}}>{ui('recovery.settings')}</Text>
    {!status && !error && <Text style={{color:colors.text}}>{ui('recovery.loading')}</Text>}
    {status && !status.enabled && <Text style={{color:colors.text}}>{ui('recovery.unavailable')}</Text>}
    {status?.enabled && status.password_account && <>
      <Text style={{color:colors.text}}>{ui('recovery.help')}</Text>
      <Text style={{color:colors.text}}>{status.verified_email?ui('recovery.verifiedAddress',{email:status.verified_email}):ui('recovery.none')}</Text>
      {!!status.pending_email && <Text style={{color:colors.text}}>{ui('recovery.pendingAddress',{email:status.pending_email})}</Text>}
      <FormInput accessibilityLabel={ui('common.email')} placeholder={ui('common.email')} value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!busy} style={inputStyle} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()}/>
      <FormInput ref={passwordRef} accessibilityLabel={ui('recovery.currentPassword')} placeholder={ui('recovery.currentPassword')} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} style={inputStyle} returnKeyType="done" onSubmitEditing={() => {if(!removing)void save();}}/>
      <Action label={ui('recovery.save')} disabled={busy || !password || !validSignupEmail(email)} onPress={() => void save()}/>
      {(!!status.verified_email || !!status.pending_email) && <Action label={ui('recovery.remove')} disabled={busy} onPress={() => setRemoving(true)}/>}
      {removing && <><Text style={{color:colors.text}}>{ui('recovery.removeHelp')}</Text><Action label={ui('recovery.confirmRemove')} disabled={busy || !password} onPress={() => void save(true)}/><Action label={ui('recovery.back')} disabled={busy} onPress={() => setRemoving(false)}/></>}
    </>}
    {!!message && <Text accessibilityRole="alert" style={{color:colors.text}}>{message}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}
  </View>;
}
