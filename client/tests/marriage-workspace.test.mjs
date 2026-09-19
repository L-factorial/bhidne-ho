import test from 'node:test';
import assert from 'node:assert/strict';
import { marriageDecision, marriageHandSnap, marriageHandLayout } from '../src/multiplayer/marriageWorkspace.ts';
const view = (actions, actor = '1') => ({ public: { current_player_id: actor }, private: { player_id: '1', actions: { drawable_sources: [], ...actions } } });
test('Marriage instructions follow server actions, including finish after a winning discard', () => {
  assert.equal(marriageDecision(view({ kinds: ['draw'], drawable_sources: ['stock'] }), true), 'DRAW_REQUIRED');
  assert.equal(marriageDecision(view({ kinds: ['discard', 'show_initial_melds'] }), true), 'DISCARD_REQUIRED');
  assert.equal(marriageDecision(view({ kinds: ['finish'] }), true), 'FINISH_REQUIRED');
  assert.equal(marriageDecision(view({ kinds: ['draw'], drawable_sources: [] }), true), 'WAITING');
  assert.equal(marriageDecision(view({ kinds: ['discard'] }, '2'), true), 'WAITING');
  assert.equal(marriageDecision(view({ kinds: ['discard'] }), false), 'WAITING');
  assert.equal(marriageDecision({ public: {}, private: null }, true), 'WAITING');
  assert.equal(marriageHandSnap('DRAW_REQUIRED'), 'collapsed');
  assert.equal(marriageHandSnap('DISCARD_REQUIRED'), 'expanded');
  assert.equal(marriageHandSnap('WAITING'), 'collapsed');
  assert.equal(marriageHandSnap('FINISH_REQUIRED'), 'expanded');
});
test('21–22 cards remain readable and fit their overlapping rows on phones', () => {
  for (const width of [280, 304, 336, 374, 744]) for (const count of [7, 21, 22]) {
    const layout = marriageHandLayout(count, width);
    assert.equal(layout.cardWidth, 58);
    assert.equal(layout.cardHeight, 86);
    assert.ok(layout.step >= 38);
    for (let index = 0; index < count; index++) {
      assert.ok((index % layout.columns) * layout.step + layout.cardWidth <= width + 0.01);
      assert.ok(Math.floor(index / layout.columns) * 100 + 12 + layout.cardHeight <= layout.height);
    }
  }
});
