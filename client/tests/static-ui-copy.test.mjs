import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import i18n from '../src/i18n/core.ts';
import { ruleFieldLabel, ruleValueLabel } from '../src/i18n/ruleCopy.ts';
import { ui } from '../src/i18n/copy.ts';

test('screens and components keep prose and accessibility labels in translation catalogs', () => {
  const untranslated = [];
  for (const folder of ['components', 'screens']) {
    const directory = new URL(`../src/${folder}/`, import.meta.url);
    for (const file of readdirSync(directory).filter(name => name.endsWith('.tsx'))) {
      const source = ts.createSourceFile(file, readFileSync(new URL(file, directory), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = node => {
        // D is the dealer marker; R is a room avatar initial.
        if (ts.isJsxText(node) && /[a-zA-Z]/.test(node.text) && !['D', 'R'].includes(node.text.trim())) {
          untranslated.push(`${file}: ${node.text.trim()}`);
        }
        if (ts.isJsxAttribute(node) && /^(title|label|placeholder|accessibilityLabel|accessibilityHint|sendLabel|closeLabel)$/.test(node.name.text)
            && node.initializer && ts.isStringLiteral(node.initializer) && /[a-zA-Z]/.test(node.initializer.text)) {
          untranslated.push(`${file}: ${node.getText(source)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  assert.deepEqual(untranslated, []);
});

test('rule descriptions and interpolated help change language without changing values', async () => {
  const config = { rules: { boot_amount: 5, sequence_ace_policy: 'a23_first' }, player: 'Fold' };
  const before = JSON.stringify(config);
  try {
    await i18n.changeLanguage('en');
    const english = ruleFieldLabel('rules.boot_amount');
    await i18n.changeLanguage('ne');
    assert.notEqual(ruleFieldLabel('rules.boot_amount'), english);
    for (const key of ['tiplu', 'jhiplu', 'poplu', 'alter', 'weak_hand_enabled', 'payments', 'tunnela_scope']) {
      assert.match(ruleFieldLabel(key), /[\u0900-\u097f]/, key);
    }
    assert.match(ruleValueLabel(config.rules.sequence_ace_policy), /[\u0900-\u097f]/);
    assert.match(ui('common.waiting_for_player', { player: config.player }), /Fold/);
    assert.match(ui('common.finish_groups_help', { count: 12 }), /12/);
    assert.equal(JSON.stringify(config), before);
  } finally { await i18n.changeLanguage('en'); }
});
