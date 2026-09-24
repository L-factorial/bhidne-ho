import test from 'node:test';
import assert from 'node:assert/strict';
import i18n from '../src/i18n/core.ts';
import { uiCatalogs } from '../src/i18n/catalogs.ts';
import { ui, uiLabel } from '../src/i18n/copy.ts';
import { phaseLabel, gameLabel } from '../src/i18n/display.ts';
import { tableEntry } from '../src/multiplayer/tableNavigation.ts';
import { marriageDecision } from '../src/multiplayer/marriageWorkspace.ts';
import { flushDecision } from '../src/multiplayer/flushDecision.ts';

test('catalogs have matching keys, nonempty Nepali, and identical interpolation fields', () => {
  const fields = value => [...new Set([...value.matchAll(/\{\{(.*?)\}\}/g)].map(m => m[1]))].sort();
  assert.deepEqual(Object.keys(uiCatalogs.en), Object.keys(uiCatalogs.ne));
  for (const [group, entries] of Object.entries(uiCatalogs.en)) {
    assert.deepEqual(Object.keys(entries).sort(), Object.keys(uiCatalogs.ne[group]).sort(), group);
    for (const [key, english] of Object.entries(entries)) {
      const nepali = uiCatalogs.ne[group][key];
      assert.ok(nepali.trim(), `${group}.${key}`);
      assert.deepEqual(fields(english), fields(nepali), `${group}.${key}`);
    }
  }
});

test('switching languages preserves names and numbers and uses contextual game wording', async () => {
  try {
    await i18n.changeLanguage('ne');
    assert.equal(ui('rooms.invite_player', { player: 'Fold' }), 'Fold लाई बोलाउने');
    assert.notEqual(ui('flush.fold'), ui('marriage.fold'));
    assert.match(ui('marriage.eligible_combination_count', { count: 2 }), /2/);
    assert.equal(uiLabel('my own custom phrase'), 'my own custom phrase');
    const message = ui('feedback.could_not_create_room');
    await i18n.changeLanguage('en');
    assert.equal(uiLabel(message, 'feedback'), 'Could not create room.');
    assert.equal(ui('marriage.eligible_combination_count', { count: 1 }), 'Eligible to see Maal · 1 combination ready');
    assert.equal(ui('marriage.eligible_combination_count', { count: 2 }), 'Eligible to see Maal · 2 combinations ready');
  } finally { await i18n.changeLanguage('en'); }
});

test('Nepali display labels do not change game decisions or transport identifiers', async () => {
  try {
    await i18n.changeLanguage('ne');
    const entry = tableEntry({ phase: 'OPEN', current_user: { can_join: true } });
    assert.equal(entry.action, 'seat');
    assert.notEqual(entry.label, 'Take seat');
    assert.notEqual(phaseLabel('OPEN'), 'OPEN');
    assert.notEqual(gameLabel('marriage'), 'Marriage');
    assert.equal(marriageDecision(undefined, false), 'WAITING');
    const decision = flushDecision({ public: { status: 'playing', round_number: 1, current_player_id: '1', pending_show: { target_id: '2' } } }, true);
    assert.equal(decision.key, '1:show:2');
    i18n.addResource('en', 'ui', 'fallback_test', 'English fallback');
    assert.equal(i18n.t('fallback_test', { ns: 'ui' }), 'English fallback');
  } finally { await i18n.changeLanguage('en'); }
});
