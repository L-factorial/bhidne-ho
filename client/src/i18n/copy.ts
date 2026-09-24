import i18n from './core.ts';
import { uiCatalogs, type UiKey } from './catalogs.ts';

export function ui(key: UiKey, values: Record<string, unknown> = {}): string {
  return String(i18n.t(key, { ...values, ns: 'ui' }));
}

// Only for developer-owned configuration labels. Never pass names, chat or input.
// Exact lookup only: dynamic messages use ui(key, { values }) instead.
const labels = new Map<string, UiKey>();
for (const [group, entries] of Object.entries(uiCatalogs.en)) {
  for (const [key, value] of Object.entries(entries)) {
    if (!value.includes('{{')) {
      labels.set(`${group}:${value}`, `${group}.${key}` as UiKey);
      if (!labels.has(value)) labels.set(value, `${group}.${key}` as UiKey);
      labels.set(`${group}:${value.toLowerCase()}`, `${group}.${key}` as UiKey);
      if (!labels.has(value.toLowerCase())) labels.set(value.toLowerCase(), `${group}.${key}` as UiKey);
      const translated = (uiCatalogs.ne[group as keyof typeof uiCatalogs.ne] as Record<string, string>)[key];
      labels.set(`${group}:${translated}`, `${group}.${key}` as UiKey);
      if (!labels.has(translated)) labels.set(translated, `${group}.${key}` as UiKey);
    }
  }
}
export function uiLabel(value: string, group?: keyof typeof uiCatalogs.en): string {
  const key = (group && (labels.get(`${group}:${value}`) || labels.get(`${group}:${value.toLowerCase()}`))) || labels.get(value) || labels.get(value.toLowerCase());
  return key ? ui(key) : value;
}
