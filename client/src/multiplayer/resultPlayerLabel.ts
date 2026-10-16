/** Eight displayed characters, including the three literal dots. */
export function resultPlayerLabel(name: string, own: boolean, you: string): string {
  if (own) return you;
  const characters = Array.from(name);
  return characters.length > 8 ? characters.slice(0, 5).join('') + '...' : name;
}
