// Count Unicode characters consistently with the server; never trim passwords.
export function validNewPassword(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 8 && length <= 128;
}
