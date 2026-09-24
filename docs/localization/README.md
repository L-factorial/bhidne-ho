# Short UI copy for Nepali mapping

For implementation and future wording edits, read **[Frontend localization architecture](architecture.md)**. Runtime English/Nepali catalogs now live in `client/src/i18n/locales/`.

The **[English → Nepali wording review](nepali-wording-review.md)** and inventories below record the original planning pass. Edit the runtime catalogs to change the app.

Start with **[ui-copy.csv](ui-copy.csv)**. Open it in a spreadsheet and fill the **Nepali** column. This is a source inventory, not a runtime language change.

| File | Contents |
| --- | --- |
| [ui-copy.csv](ui-copy.csv) | 1,251 distinct short English strings/templates, grouped by screen area, with a blank Nepali column and source locations |
| [ui-copy.json](ui-copy.json) | Same strings, stable IDs, every source location, and the expressions supplying each placeholder |
| [existing-translations.json](existing-translations.json) | 71 existing English/Nepali pairs and their current i18next keys; reuse these translations |
| [dynamic-bindings.json](dynamic-bindings.json) | Directly rendered expressions and client-side state/action codes that need a display mapping or must remain user data |
| [server-copy.json](server-copy.json) | 416 server message candidates and 163 enum values with source locations; some are internal errors and may never reach the UI |

The frontend list distinguishes 662 entries extracted from UI text/label fields (`ui`) from 589 additional literals/templates (`candidate`). Review candidates in their source context before translating or wiring. Identical English text is grouped across sources; split its eventual translation key if its meaning differs by context.

## Areas collected

- **Shared:** navigation, buttons, dialogs, loading, reconnecting, confirmations, game names, theme names, card suits, hand controls, accessibility labels.
- **Rooms and tables:** creation/joining, privacy labels, active tables, open seats, queue, watching, invitations, host controls, lock/start/end, ready/waiting/finished states.
- **Call Break:** shuffle/cut/deal/bid/play/scores, turn instructions, hand acceptance/redeal, bidding, legal-card guidance, tricks, deal and match results.
- **Flush:** blind/seen, bet/call/raise/pack/show/side-show, accept/reject, pot and amounts, folded/out/winner, short settings labels.
- **Marriage:** draw/discard/finish, Maal qualification, sequence/Tunnela/Dublee labels, arrangement and hand tools, missing-card/ready messages, eighth Dublee, winning-hand preview, announcements and short scoring labels.
- **Social:** chat controls, poke targeting, Love/Pinch/Clap/Cheers/Laugh/Playful hammer, send/receive notifications and canned short copy.
- **Scores and ledger:** results, balances, amounts, payment/confirmation states and settlement actions.

Examples present in the inventory include `Your turn · Draw a card`, `Your turn · Confirm discard`, `Your turn · Finish round`, `Waiting for players`, `Lock players`, `Start game`, `Take seat`, `Join queue`, `Create table`, and templates such as `Need at least {{value1}} players`.

## Mapping rules

1. Translate the **English sentence or label**, preserving each `{{valueN}}` placeholder. Placeholders may move within the Nepali sentence. JSON `sources[].bindings` identifies the original expression behind each value.
2. Never translate actual player/profile data, room or table names, typed chat, saved personal phrases, links, IDs, or card IDs. A sentence around a name can be translated; the supplied name stays unchanged.
3. Some placeholders are themselves display labels, such as an action, suit, state, or game name. Translate those through their own label mapping before interpolation. Do not assume every placeholder is a name or number.
4. Keep protocol values such as `DRAW_CARD`, `SHOW_DUBLEES`, `must_discard`, and `OPEN` unchanged. Map code → display label at the rendering boundary. The code inventory is a review checklist, not permission to rename commands or enum values.
5. Keep server validation authoritative. Display a localized message using a stable error code where available; retain a fallback for unknown codes. Do not blindly translate arbitrary server/user strings by search-and-replace.
6. Long text is deferred: the collectors omit text longer than 160 characters or 26 words. This is a length-based scope filter, not a complete classification of rules. Short rule/setting labels remain included.
7. Profile editing/detail files are excluded. Navigation labels leading to the profile may still occur elsewhere. Only source-defined text is inspected; no saved user data is read.

## What still needs review before integration

This inventory is deliberately broader than only button labels. The `candidate` rows may include internal messages or unused preview copy. Conversely, text assembled entirely from expressions, concatenation, or server fields needs review in `dynamic-bindings.json`; the collector cannot infer every runtime string. It must not be treated as proof that every rendered message is already translated.

No theme or language behavior is changed. Existing localization uses the saved English/Nepali language preference independently of the visual table theme. Connecting a Nepali theme to a language mapping is a subsequent integration step.

## Refreshing the inventory

From the repository root:

```powershell
node client/scripts/collect-ui-copy.cjs
.venv/Scripts/python.exe scripts/collect_backend_ui_copy.py
```

The frontend script requires the client's installed TypeScript dependency. Stable IDs derive from English text. Regeneration preserves `ne` values edited in `ui-copy.json` and `server-copy.json`, but **rewrites the CSV**. Keep a separately edited spreadsheet until its translations have been imported into the JSON; no CSV importer or runtime wiring is included yet.
