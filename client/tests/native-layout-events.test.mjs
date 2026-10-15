import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import ts from 'typescript';

// Exercise the actual JSX callbacks with React Native's event-release timing:
// state updater functions may run after the native event has been cleared.
for (const file of ['TableSeatLayout', 'FlushArena']) {
  const source = ts.createSourceFile(file + '.tsx',
    readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onLayout'
        && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expression = node.initializer.expression?.getText(source);
      if (expression?.includes('setCenterHeight')) handlers.push(expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  test(`${file} snapshots native layout before deferred state updates`, () => {
    assert.equal(handlers.length, file === 'FlushArena' ? 2 : 1);
    for (const expression of handlers) for (const capacity of [4, 5, 6]) {
      const updates = [];
      const handler = new Function('setCenterHeight', 'capacity', `return (${expression});`)(
        update => updates.push(update), capacity);
      const event = {nativeEvent: {layout: {height: 123.4}}};
      handler(event);
      event.nativeEvent = null;
      assert.equal(updates.length, 1);
      assert.equal(updates[0](0), file === 'TableSeatLayout' ? 132 : 124);
      assert.equal(updates[0](200), 200);
    }
  });
}

test('Call Break card-table measurements survive native event release', () => {
  const source = ts.createSourceFile('CardTable.tsx',
    readFileSync(new URL('../src/components/CardTable.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onLayout'
        && node.initializer && ts.isJsxExpression(node.initializer)) {
      expression = node.initializer.expression?.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression?.includes('setSeatMeasurement'));
  const updates = [];
  const handler = new Function('detailedStats', 'measurementKey', 'setSeatMeasurement',
    `return (${expression});`)(true, 'callbreak-seats', update => updates.push(update));
  const event = {nativeEvent: {layout: {height: 120}}};
  handler(event);
  event.nativeEvent = null;
  assert.deepEqual(updates[0]({key: 'callbreak-seats', height: 0}), {key: 'callbreak-seats', height: 128});
  const larger = {key: 'callbreak-seats', height: 200};
  assert.equal(updates[0](larger), larger);
});

test('no client callback captures nativeEvent inside a nested callback', () => {
  const violations = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) { scan(url); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'),
        ts.ScriptTarget.Latest, true, entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const isFunction = node => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
      function visit(node) {
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'nativeEvent'
            && ts.isIdentifier(node.expression)) {
          const eventName = node.expression.text;
          let depth = 0;
          for (let scope = node.parent; scope; scope = scope.parent) {
            if (!isFunction(scope)) continue;
            if (scope.parameters.some(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === eventName)) {
              if (depth > 0) violations.push(`${entry.name}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
              break;
            }
            depth++;
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(new URL('../src/', import.meta.url));
  assert.deepEqual(violations, [], 'Read native values before entering another callback');
});
