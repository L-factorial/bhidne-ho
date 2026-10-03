import test from 'node:test';
import assert from 'node:assert/strict';
import { GameModalLayers } from '../src/components/GameModalLayers.ts';

test('snapshot updates keep confirmation above its underlying menu', () => {
  const layers = new GameModalLayers(), menu = Symbol('menu'), confirmation = Symbol('confirmation');
  layers.show(menu, 'menu');
  layers.show(confirmation, 'end for everyone');
  layers.show(menu, 'updated player list');
  assert.deepEqual(layers.getSnapshot(), [
    { id: menu, content: 'updated player list' },
    { id: confirmation, content: 'end for everyone' },
  ]);
  layers.hide(confirmation);
  assert.equal(layers.getSnapshot().at(-1).id, menu);
});

test('hiding or unmounting a layer never removes another dialog', () => {
  const layers = new GameModalLayers(), menu = Symbol('menu'), chat = Symbol('chat');
  layers.show(menu, 'menu'); layers.show(chat, 'draft');
  layers.hide(menu); layers.hide(menu);
  assert.deepEqual(layers.getSnapshot(), [{ id: chat, content: 'draft' }]);
  layers.show(menu, 'reopened menu');
  assert.equal(layers.getSnapshot().at(-1).id, menu);
});

test('native dismissal releases every layer and a reopened table starts clean', () => {
  const layers = new GameModalLayers(), menu = Symbol('menu'), confirm = Symbol('confirm');
  let changes = 0;
  const unsubscribe = layers.subscribe(() => changes++);
  layers.show(menu, 'menu'); layers.show(confirm, 'confirm');
  const previous = layers.getSnapshot();
  assert.equal(previous, layers.getSnapshot(), 'external-store snapshots are stable until changed');
  layers.clear();
  assert.deepEqual(layers.getSnapshot(), []);
  assert.equal(previous.length, 2, 'old snapshots remain immutable');
  const clean = layers.getSnapshot();
  layers.hide(menu); layers.clear();
  assert.equal(clean, layers.getSnapshot());
  assert.equal(changes, 3);
  unsubscribe();
  layers.show(menu, 'new table');
  assert.equal(changes, 3);
  assert.deepEqual(layers.getSnapshot(), [{ id: menu, content: 'new table' }]);
});

test('Back closes the top dialog before its menu or the game', () => {
  const layers = new GameModalLayers(), menu = Symbol('menu'), confirm = Symbol('confirm');
  const closed = [];
  layers.show(menu, 'menu', () => { closed.push('menu'); layers.hide(menu); });
  layers.show(confirm, 'confirmation', () => { closed.push('confirmation'); layers.hide(confirm); });
  assert.equal(layers.requestCloseTop(), true);
  assert.deepEqual(closed, ['confirmation']);
  assert.equal(layers.requestCloseTop(), true);
  assert.deepEqual(closed, ['confirmation', 'menu']);
  assert.equal(layers.requestCloseTop(), false, 'parent can now return to room');
});
