# Editing English and Nepali UI copy

The runtime source of truth is `client/src/i18n/locales/`. Edit the matching English and Nepali files to change wording. No component or game-logic change is needed for a wording edit.

| File in each language folder | Owns |
| --- | --- |
| `common.ts` | Navigation, dialogs, themes, card controls, shared accessibility labels |
| `rooms.ts` | Lobby, rooms, tables, seats, invitations, game lifecycle |
| `callbreak.ts` | Bidding, turns, tricks, deal progress |
| `flush.ts` | Bets, shows, side-shows, pots and rule controls |
| `marriage.ts` | Maal, both qualification routes, finishing tools, declarations, scores |
| `social.ts` | Friends, chat and poke controls |
| `ledger.ts` | Results and settlement labels |
| `feedback.ts` | Known short error and connection messages |

`resources.ts` retains the existing welcome/chat/ledger translations, so existing `useTranslation()` callers remain compatible. New copy belongs in the feature catalogs, not in this legacy file.

## Components and dynamic messages

```tsx
import { ui } from '../i18n/copy';
import { useUiLanguage } from '../i18n/useUiLanguage';

function InviteButton({ playerName, invite }) {
  useUiLanguage();
  return <Button title={ui('rooms.invite_player', { player: playerName })} onPress={invite} />;
}
```

Keys are checked by TypeScript. Keep keys stable when changing the text. Keep `{{placeholder}}` names identical in both languages; reorder them freely to suit Nepali grammar. Use complete sentences rather than translating fragments around a name. Use i18next `_one` / `_other` entries with a numeric `count` for plural messages.

`useUiLanguage()` subscribes the component without remounting it. Include its returned value in a `useMemo` or `useCallback` dependency list if that calculation contains translated text. Resolve copy during rendering or when producing a message, never in a module-level translated constant.

`copy.ts` provides `ui(key, values)`. Its `uiLabel` adapter is restricted to developer-owned configuration labels and known feedback strings. It uses exact catalog lookup, with English fallback for unknown labels. It does not infer translations from arbitrary dynamic sentences. Pass names, chat, saved phrases, room/table names and IDs directly as interpolation values; never pass them to `uiLabel`.

`display.ts` maps protocol phases, game IDs and meld kinds to presentation text. Commands, enum comparisons, API payloads and server validation remain independent of the chosen language. Buttons use explicit styling flags and menu icons rather than inferring behavior from translated labels.

## Language preference

`LanguageProvider.tsx` owns `en` / `ne`, saved under `bhidne.language`. A saved choice wins on the next visit; otherwise English is the default regardless of device locale. An explicit selection made during storage hydration wins over the old saved value. Storage writes are serialized.

Language and visual table theme are independent. Selecting Nepali changes wording, while selecting Nepali Heritage changes appearance. Switching either preserves the current page and form state.

`core.ts` initializes the shared i18next instance with English fallback. It has no Expo or React Native dependency, so presentation helpers and Node tests can use it. `index.ts` connects that instance to React and defines the English default.

## Validation

From `client/`:

```sh
npm run typecheck
node --experimental-strip-types --test --test-isolation=none tests/*.test.mjs
npm run build:web
```

`tests/localization.test.mjs` checks catalog parity, placeholders, plural messages, fallback and unchanged game identifiers. `tests/browser/localization.cjs` exercises saved language, Nepali room creation and lock/start commands in all three games against a local memory-runtime server. Set `TEST_WEB_URL` and `PLAYWRIGHT_MODULE` as needed.

The earlier CSV/JSON inventories and wording review are historical review material, not runtime inputs. Long rules, user content and profile data remain outside this pass. Unrecognized server messages retain their original text; add a reviewed key and an explicit error-code mapping when expanding that coverage.
