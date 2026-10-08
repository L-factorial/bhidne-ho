// Stable IDs are independent of artwork loading and the app/table color palette.
export const cardThemeCatalog = {
  kathmandu: { nameKey: 'common.card_theme_kathmandu' },
  everest: { nameKey: 'common.card_theme_everest' },
  boudhanath: { nameKey: 'common.card_theme_boudhanath' },
  pokhara: { nameKey: 'common.card_theme_pokhara' },
  pashupatinath: { nameKey: 'common.card_theme_pashupatinath' },
  chitwan: { nameKey: 'common.card_theme_chitwan' },
  bhaktapur: { nameKey: 'common.card_theme_bhaktapur' },
  rara: { nameKey: 'common.card_theme_rara' },
  lumbini: { nameKey: 'common.card_theme_lumbini' },
  annapurna: { nameKey: 'common.card_theme_annapurna' },
} as const;
export type CardThemeId = keyof typeof cardThemeCatalog;
export const defaultCardTheme: CardThemeId = 'kathmandu';
export const cardThemeStorageKey = 'bhidne.card-theme.v1';
export function isCardThemeId(value: unknown): value is CardThemeId {
  return typeof value === 'string' && Object.hasOwn(cardThemeCatalog, value);
}
