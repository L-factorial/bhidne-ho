// Exercises actual React components against a controllable iOS Modal boundary.
// This verifies dismissal ordering, not UIKit. See TESTFLIGHT.md for device checks.
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
const h = React.createElement;
const DeletionNavigation = React.createContext(() => {});
const PolicyNavigation = React.createContext(() => {});
let keyboardDismissals = 0;
const native = { Platform: { OS: 'ios' }, Modal: 'NativeModal', Pressable: 'Pressable',
  Text: 'Text', View: 'View', ImageBackground: 'ImageBackground', Keyboard: { dismiss() { keyboardDismissals++; } } };
const modules = new Map();
function load(name) {
  const file = path.resolve(__dirname, '../src/components', name);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const imported = name => {
    if (name === 'react-native') return native;
    if (name.startsWith('react')) return testRequire(name);
    if (name === './GameModal') return load('GameModal.tsx');
    if (name === './GameModalLayers') return load('GameModalLayers.ts');
    if (name === './useDismissalAction') return load('useDismissalAction.ts');
    if (name === '../auth/deletion') return { DeletionNavigation };
    if (name === './moderation/PublicPolicies') return { PolicyNavigation };
    if (name === './RoomSheet') return { RoomSheet: 'RoomSheet' };
    if (name === './ShareLink') return { RoomShareActions: 'RoomShareActions' };
    if (name === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (name === 'expo-linear-gradient') return { LinearGradient: 'LinearGradient' };
    if (name.endsWith('/playerError.ts')) return { playerError: error => error.message };
    if (name.endsWith('/copy.ts')) return { ui: key => key, uiLabel: value => value };
    if (name.endsWith('/useUiLanguage')) return { useUiLanguage() {} };
    if (name === '../theme') return { useTheme: () => ({ colors: {} }), fonts: {}, radii: {}, typography: {},
      gameControlFinish: () => ({}), gamePanelFinish: () => ({}) };
    if (name.endsWith('.jpg')) return 1;
    throw new Error(`Unexpected import: ${name}`);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(imported, module, module.exports);
  return module.exports;
}
const { useDismissalAction } = load('useDismissalAction.ts');
const { ProfileModal, ProfileDismissal } = load('ProfileModal.tsx');
const { RoomCard } = load('RoomCard.tsx');

function Actions() {
  const deletion = React.useContext(DeletionNavigation), policy = React.useContext(PolicyNavigation);
  const dismiss = React.useContext(ProfileDismissal);
  return h('Actions', { deletion, policy, signOut: action => dismiss(action) });
}
function ProfileFixture({ events }) {
  const [visible, setVisible] = React.useState(true), [owner, setOwner] = React.useState(true);
  const navigate = value => { events.push(value); setOwner(false); };
  return h(DeletionNavigation.Provider, { value: () => navigate('deletion') },
    h(PolicyNavigation.Provider, { value: page => navigate(page) }, owner
      ? h(ProfileModal, { visible, onClose: () => setVisible(false) }, h(Actions)) : h('Destination')));
}
function HookFixture({ visible = true, onClose, action }) {
  const { afterDismiss, onDismiss, cancel } = useDismissalAction(visible, onClose);
  return h('Hook', { afterDismiss: () => afterDismiss(action), onDismiss, cancel });
}

test('profile deletion, policy and sign-out wait for iOS dismissal before replacing the owner', async () => {
  native.Platform.OS = 'ios';
  for (const action of ['deletion', 'privacy', 'sign-out']) {
    const events = []; let renderer;
    await act(async () => { renderer = create(h(ProfileFixture, { events })); });
    try {
      await act(async () => {
        const controls = renderer.root.findByType('Actions').props;
        if (action === 'deletion') { controls.deletion(); controls.deletion(); }
        else if (action === 'privacy') controls.policy('privacy');
        else controls.signOut(() => events.push('sign-out'));
      });
      const modal = renderer.root.findByType('NativeModal');
      assert.equal(modal.props.visible, false);
      assert.equal(renderer.root.findAllByType('Actions').length, 1, 'contents survive dismissal');
      assert.deepEqual(events, [], 'navigation cannot run during the closing animation');
      const dismissed = modal.props.onDismiss;
      await act(async () => { dismissed(); });
      assert.deepEqual(events, [action]);
      await act(async () => { dismissed(); });
      assert.deepEqual(events, [action], 'native dismiss notification is idempotent');
    } finally { await act(async () => { renderer.unmount(); }); }
  }
  assert.ok(keyboardDismissals >= 3);
});

test('profile Back closes without submitting deletion or navigation', async () => {
  native.Platform.OS = 'ios'; const events = []; let renderer;
  await act(async () => { renderer = create(h(ProfileFixture, { events })); });
  try {
    await act(async () => { renderer.root.findByType('NativeModal').props.onRequestClose(); });
    assert.equal(renderer.root.findByType('NativeModal').props.visible, false);
    await act(async () => { renderer.root.findByType('NativeModal').props.onDismiss(); });
    assert.deepEqual(events, []);
  } finally { await act(async () => { renderer.unmount(); }); }
});

test('a pending action is canceled by unmount or reopening; late dismiss cannot navigate', async () => {
  native.Platform.OS = 'ios'; let renderer; const events = [];
  const props = { onClose: () => events.push('close'), action: () => events.push('action') };
  await act(async () => { renderer = create(h(HookFixture, props)); });
  await act(async () => { renderer.root.findByType('Hook').props.afterDismiss(); });
  await act(async () => { renderer.update(h(HookFixture, { ...props, visible: false })); });
  const oldDismiss = renderer.root.findByType('Hook').props.onDismiss;
  await act(async () => { renderer.update(h(HookFixture, props)); });
  await act(async () => { oldDismiss(); });
  await act(async () => { renderer.update(h(HookFixture, { ...props, visible: false })); oldDismiss(); });
  assert.deepEqual(events, ['close']);
  await act(async () => { renderer.update(h(HookFixture, props)); });
  await act(async () => { renderer.root.findByType('Hook').props.afterDismiss(); renderer.unmount(); });
  await act(async () => { oldDismiss(); });
  assert.deepEqual(events, ['close', 'close']);
});

test('web and Android execute after committing hidden state without waiting for an iOS event', async () => {
  for (const platform of ['web', 'android']) {
    native.Platform.OS = platform; const events = []; let renderer;
    const props = { onClose: () => events.push('close'), action: () => events.push('action') };
    await act(async () => { renderer = create(h(HookFixture, props)); });
    try {
      await act(async () => { renderer.root.findByType('Hook').props.afterDismiss(); });
      assert.deepEqual(events, ['close']);
      await act(async () => { renderer.update(h(HookFixture, { ...props, visible: false })); });
      assert.deepEqual(events, ['close', 'action']);
      await act(async () => { renderer.root.findByType('Hook').props.onDismiss(); });
      assert.deepEqual(events, ['close', 'action']);
    } finally { await act(async () => { renderer.unmount(); }); }
  }
  native.Platform.OS = 'ios';
});

test('canceling a queued room/session action prevents a later dismissal from running it', async () => {
  native.Platform.OS = 'ios'; const events = []; let renderer;
  const props = { onClose: () => events.push('close'), action: () => events.push('delete') };
  await act(async () => { renderer = create(h(HookFixture, props)); });
  try {
    await act(async () => { renderer.root.findByType('Hook').props.afterDismiss(); });
    await act(async () => { renderer.update(h(HookFixture, { ...props, visible: false })); });
    await act(async () => { renderer.root.findByType('Hook').props.cancel(); });
    await act(async () => { renderer.root.findByType('Hook').props.onDismiss(); });
    assert.deepEqual(events, ['close']);
  } finally { await act(async () => { renderer.unmount(); }); }
});

test('room-card deletion closes first, deduplicates taps, preserves the card on failure and retries', async () => {
  native.Platform.OS = 'ios'; let renderer, calls = 0, failed = true;
  const room = { room_id: 'fixture-room', name: 'Fixture', members: ['owner'] };
  await act(async () => { renderer = create(h(RoomCard, { room, member: true, owner: true, busy: false,
    onPress() {}, onRemove: async () => { calls++; if (failed) throw new Error('Retry deletion'); } })); });
  const open = () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'common.delete Fixture');
  const sheet = () => renderer.root.findAllByType('RoomSheet')[0];
  const confirm = () => sheet().findAllByType('Pressable').find(node => node.findByType('Text').props.children === 'rooms.delete_room');
  try {
    await act(async () => { open().props.onPress(); });
    await act(async () => { sheet().props.onClose(); });
    assert.equal(calls, 0, 'cancel sends no deletion request');
    await act(async () => { open().props.onPress(); });
    await act(async () => { const press = confirm().props.onPress; press(); press(); });
    assert.equal(sheet().props.visible, false);
    assert.equal(calls, 0, 'room-card owner survives until its confirmation dismisses');
    assert.equal(open().props.disabled, true);
    await act(async () => { sheet().props.onDismiss(); });
    assert.equal(calls, 1);
    assert.equal(sheet().props.visible, true, 'failure reopens confirmation with its error');
    assert.ok(sheet().findAllByType('Text').some(node => node.props.children === 'Retry deletion'));
    failed = false;
    await act(async () => { confirm().props.onPress(); });
    assert.equal(calls, 1);
    const dismiss = sheet().props.onDismiss;
    await act(async () => { dismiss(); });
    assert.equal(calls, 2);
    assert.equal(renderer.root.findAllByType('RoomSheet').length, 0, 'successful removal can now remove the card');
    await act(async () => { dismiss(); });
    assert.equal(calls, 2);
  } finally { await act(async () => { renderer.unmount(); }); }
});
