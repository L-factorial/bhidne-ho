// React lifecycle test with an iOS-shaped Modal host; this is not a UIKit test.
// npm install --prefix /private/tmp/bhidne-native-modal-tests --no-audit --no-fund react@19.2.3 react-test-renderer@19.2.3
// TEST_REACT_TOOLS=/private/tmp/bhidne-native-modal-tests node --test tests/native-game-modal.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const testRequire = process.env.TEST_REACT_TOOLS
  ? createRequire(path.join(process.env.TEST_REACT_TOOLS, 'package.json')) : require;
const React = testRequire('react');
const { act, create } = testRequire('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const native = { Platform: { OS: 'ios' }, Modal: 'NativeModal', View: 'View',
  Keyboard: { dismiss() {} }, StyleSheet: { absoluteFill: { position: 'absolute', inset: 0 } } };
const modules = new Map();
function load(file) {
  file = path.resolve(__dirname, '../src/components', file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const imported = name => name === 'react-native' ? native : name.startsWith('react') ? testRequire(name)
    : name === './GameModalLayers' ? load('GameModalLayers.ts') : require(name);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(imported, module, module.exports);
  return module.exports;
}
const { GameModal, GameModalRoot, GameModalContent } = load('GameModal.tsx');
const h = React.createElement;
const Theme = React.createContext(null), Social = React.createContext(null);
function ContextProbe() {
  return h('Probe', { theme: React.useContext(Theme), social: React.useContext(Social) });
}
function Panels({ closeEvents }) {
  const [menu, setMenu] = React.useState(false), [dialog, setDialog] = React.useState(false);
  return h(React.Fragment, null,
    h('button', { testID: 'open-menu', onPress: () => setMenu(true) }),
    h(GameModal, { transparent: true, visible: menu, onRequestClose: () => { closeEvents.push('menu'); setMenu(false); } },
      h('button', { testID: 'open-confirmation', onPress: () => setDialog(true) }), h(ContextProbe),
      h(GameModal, { transparent: true, visible: dialog, onRequestClose: () => { closeEvents.push('confirmation'); setDialog(false); } },
        h('Confirmation', { testID: 'confirmation' })))
  );
}
function Fixture({ visible = true, ended = false, closeEvents, onDismiss = () => {}, revision = 0 }) {
  return h(GameModalRoot, { visible, onRequestClose: () => closeEvents.push('game'), onDismiss },
    ended ? h('CreationForm') : h(Theme.Provider, { value: 'gold' }, h(Social.Provider, { value: 'table-chat' },
      h(GameModalContent, null, h('Game', { revision }), h(Panels, { closeEvents })))))
}
async function openPanels(renderer) {
  await act(async () => { renderer.root.findByProps({ testID: 'open-menu' }).props.onPress(); });
  await act(async () => { renderer.root.findByProps({ testID: 'open-confirmation' }).props.onPress(); });
}

test('native game uses one Modal, preserves social/theme context and routes Back from top to parent', async () => {
  native.Platform.OS = 'ios'; const closeEvents = []; let renderer;
  await act(async () => { renderer = create(h(Fixture, { closeEvents })); });
  try {
    await openPanels(renderer);
    assert.equal(renderer.root.findAllByType('NativeModal').length, 1);
    const probe = renderer.root.findByType('Probe');
    assert.equal(probe.props.theme, 'gold'); assert.equal(probe.props.social, 'table-chat');
    const layerViews = renderer.root.findAllByType('View').filter(node => node.props.accessibilityViewIsModal !== undefined);
    assert.deepEqual(layerViews.map(node => node.props.pointerEvents), ['none', 'auto']);
    await act(async () => { renderer.update(h(Fixture, { closeEvents, revision: 1 })); });
    assert.equal(renderer.root.findAllByType('NativeModal').length, 1);
    await act(async () => { renderer.root.findByType('NativeModal').props.onRequestClose({}); });
    assert.deepEqual(closeEvents, ['confirmation']);
    await act(async () => { renderer.root.findByType('NativeModal').props.onRequestClose({}); });
    assert.deepEqual(closeEvents, ['confirmation', 'menu']);
    await act(async () => { renderer.root.findByType('NativeModal').props.onRequestClose({}); });
    assert.deepEqual(closeEvents, ['confirmation', 'menu', 'game']);
  } finally { await act(async () => { renderer.unmount(); }); }
});

test('ending with overlays open hides all layers and retains live content through native dismissal', async () => {
  native.Platform.OS = 'ios'; const closeEvents = []; let renderer, dismissed = 0;
  const onDismiss = () => { dismissed++; };
  await act(async () => { renderer = create(h(Fixture, { closeEvents, onDismiss })); });
  try {
    await openPanels(renderer);
    await act(async () => { renderer.update(h(Fixture, { closeEvents, onDismiss, visible: false, ended: true })); });
    assert.equal(renderer.root.findAllByType('NativeModal').length, 1);
    assert.equal(renderer.root.findByType('NativeModal').props.visible, false);
    assert.equal(renderer.root.findAllByType('CreationForm').length, 0, 'no creation form during game dismissal');
    assert.equal(renderer.root.findAllByType('Game').length, 1);
    assert.equal(renderer.root.findAllByType('Confirmation').length, 0);
    assert.ok(closeEvents.includes('menu'));
    await act(async () => { renderer.root.findByType('NativeModal').props.onDismiss(); });
    assert.equal(dismissed, 1);
    await act(async () => { renderer.update(h(Fixture, { closeEvents, visible: true })); });
    assert.equal(renderer.root.findAllByType('Confirmation').length, 0);
    assert.equal(renderer.root.findAllByType('Probe').length, 0, 'reopening does not revive the old menu');
  } finally { await act(async () => { renderer.unmount(); }); }
});

test('web and dialogs outside the game keep their existing native Modal fallback', async () => {
  let renderer; native.Platform.OS = 'ios';
  await act(async () => { renderer = create(h(GameModal, { visible: true }, h('Standalone'))); });
  assert.equal(renderer.root.findAllByType('NativeModal').length, 1);
  await act(async () => { renderer.unmount(); });
  native.Platform.OS = 'web'; const closeEvents = [];
  await act(async () => { renderer = create(h(Fixture, { closeEvents })); });
  try {
    await openPanels(renderer);
    assert.equal(renderer.root.findAllByType('NativeModal').filter(node => node.props.visible).length, 3);
  } finally { await act(async () => { renderer.unmount(); }); native.Platform.OS = 'ios'; }
});

test('a late native dismissal cannot clear the newly reopened presentation', async () => {
  native.Platform.OS = 'ios'; const closeEvents = []; let renderer, dismissed = 0;
  const onDismiss = () => { dismissed++; };
  await act(async () => { renderer = create(h(Fixture, { closeEvents, onDismiss })); });
  try {
    await act(async () => { renderer.update(h(Fixture, { closeEvents, onDismiss, visible: false })); });
    const oldDismiss = renderer.root.findByType('NativeModal').props.onDismiss;
    await act(async () => { renderer.update(h(Fixture, { closeEvents, onDismiss })); });
    await openPanels(renderer);
    await act(async () => { oldDismiss(); });
    assert.equal(dismissed, 0);
    assert.equal(renderer.root.findAllByType('Confirmation').length, 1);
  } finally { await act(async () => { renderer.unmount(); }); }
});
