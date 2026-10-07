export type PushSetupCode = 'PUSH_PERMISSION_REQUIRED' | 'PUSH_PERMISSION_FAILED' | 'PUSH_TOKEN_FAILED' | 'PUSH_ENVIRONMENT_FAILED' | 'PUSH_BUILD_REQUIRED' | 'PUSH_REGISTRATION_FAILED';
export class PushSetupError extends Error {
  readonly code: PushSetupCode;
  constructor(code: PushSetupCode) { super(code); this.code = code; }
}
type NativeRegistration = {
  token(): Promise<string>;
  environment(): Promise<'development' | 'production' | null>;
  isStoreBuild(): Promise<boolean>;
  active(): boolean;
  register(token: string, environment: 'development' | 'production'): Promise<void>;
};
// Acquire a real APNs token first. Only a positively identified App Store /
// TestFlight build may fall back when its embedded profile is unavailable.
export async function registerIosDevice(native: NativeRegistration): Promise<void> {
  let token: string;
  try { token = await native.token(); }
  catch { throw new PushSetupError('PUSH_TOKEN_FAILED'); }
  if (!native.active()) return;
  if (!/^[a-fA-F0-9]{64}$/.test(token)) throw new PushSetupError('PUSH_TOKEN_FAILED');
  let environment: 'development' | 'production' | null;
  try {
    environment = await native.environment();
    if (!native.active()) return;
    if (!environment && await native.isStoreBuild()) environment = 'production';
  } catch { throw new PushSetupError('PUSH_ENVIRONMENT_FAILED'); }
  if (!native.active()) return;
  if (!environment) throw new PushSetupError('PUSH_BUILD_REQUIRED');
  try { await native.register(token, environment); }
  catch (error) {
    // Keep authentication, availability and network errors recognizable. A 422
    // registration failure needs specific copy rather than the generic fallback.
    if (error && typeof error === 'object' && 'status' in error && error.status === 422)
      throw new PushSetupError('PUSH_REGISTRATION_FAILED');
    throw error;
  }
}
