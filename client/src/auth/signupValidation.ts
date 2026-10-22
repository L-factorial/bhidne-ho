// The sign-up form's requested username format. Sign-in retains legacy formats.
export function signupUsernameRules(value: string) {
  return [value.length >= 3 && value.length <= 32, /^[A-Za-z0-9]+$/.test(value), /^[A-Za-z]/.test(value)];
}
export function validSignupUsername(value: string): boolean {
  return signupUsernameRules(value).every(Boolean);
}
export {validNewPassword as validSignupPassword} from './password.ts';
