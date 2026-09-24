// Inventory only: does not rewrite runtime code or translate user-provided data.
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/localization');
fs.mkdirSync(output, { recursive: true });
const target = path.join(output, 'ui-copy.json');
const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')).entries : [];
const translations = new Map(previous.map(row => [row.id, row.ne]));
const entries = new Map(), codes = new Map(), dynamic = [];
const omitted = { longCopy: 0, profileFiles: [] };
const attrs = new Set(['label', 'title', 'text', 'caption', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'closeLabel', 'instruction', 'message', 'detail', 'reason', 'heading', 'subtitle', 'description', 'notice', 'emptyLabel']);
const machineAttrs = /^(testID|key|id|style|color|backgroundColor|fontFamily|fontWeight|fontSize|boxShadow|textShadowColor|transform|transformOrigin|filter|backgroundImage|accessibilityRole|role|name|type|command|phase|status|route|action|kind|source|value|game_type|gameType|meld_type|icon|outline|emoji|nativeID|pointerEvents|animationType)$/;
function category(file) {
  return /Ledger|Scoring|Results/.test(file) ? 'scores-and-ledger' : /Marriage|marriage|Maal|maal/.test(file) ? 'marriage' : /Flush|flush/.test(file) ? 'flush'
    : /CallBreak|callbreak|LiveGameTable|LiveBid|roundFlow|Bid|Deal|Round|PlayerHand/.test(file) ? 'callbreak'
    : /Poke|poke|Reaction|reaction|Chat|Social|Phrase|Friends/.test(file) ? 'social'
    : /Room|Lobby|ActiveGames|Invitation|TableCard|tableNavigation|TableControls|TableStart/.test(file) ? 'rooms-and-tables'
    : 'shared';
}
function add(text, file, node, source, bindings = {}, context = 'candidate') {
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]/.test(text) || !text.replace(/\{\{.*?\}\}/g, '').trim()) return;
  if (text.length > 160 || text.split(/\s+/).length > 26) { omitted.longCopy++; return; }
  if (/^(https?:|wss?:|\.?\.?\/|#[\da-f]+$)/i.test(text) || /^(?:[a-z]+[A-Z][A-Za-z]*|[A-Za-z]+(?:[._/-][A-Za-z0-9]+)+)$/.test(text)) return;
  if (context === 'candidate' && !/\s/.test(text) && !/^[A-Z][a-z]+$/.test(text)) return;
  const id = 'ui.' + text.toLowerCase().replace(/\{\{.*?\}\}/g, 'value').replace(/[^a-z0-9]+/g, '_').slice(0, 55).replace(/_$/, '')
    + '_' + createHash('sha1').update(text).digest('hex').slice(0, 8);
  const row = entries.get(id) || { id, en: text, ne: translations.get(id) || '', categories: [], review: context === 'candidate' ? 'candidate' : 'ui', sources: [] };
  if (context !== 'candidate') row.review = 'ui';
  const group = category(file);
  if (!row.categories.includes(group)) row.categories.push(group);
  const loc = { file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, context, ...(Object.keys(bindings).length ? { bindings } : {}) };
  if (!row.sources.some(s => s.file === file && s.line === loc.line && s.context === context)) row.sources.push(loc);
  entries.set(id, row);
}
function attribute(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p) || ts.isPropertyAssignment(p)) return p.name.getText().replace(/['"]/g, '');
    if (ts.isStatement(p) || ts.isJsxElement(p)) break;
  }
  return '';
}
function walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full);
    else if (/\.tsx?$/.test(entry.name)) scan(full);
  }
}
function scan(full) {
  const file = path.relative(root, full).replaceAll('\\', '/');
  if (/\/(ProfileScreen|DisplayNameField|RoomMemberDetails)\.tsx$/.test(file)) { omitted.profileFiles.push(file); return; }
  if (/\/i18n\//.test(file)) return;
  if (/\/(theme|tokens)\.tsx?$/.test(file)) return;
  const source = ts.createSourceFile(file, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'style') return;
    if (ts.isVariableDeclaration(node) && /^(styles|createStyles)$/.test(node.name.getText(source))) return;
    if (ts.isCallExpression(node) && /^console\./.test(node.expression.getText(source))) return;
    if (ts.isJsxElement(node) && /(^|\.)Text$/.test(node.openingElement.tagName.getText(source))) {
      const bindings = {}; let text = '', index = 0, simple = true;
      for (const child of node.children) {
        if (ts.isJsxText(child)) text += child.text;
        else if (ts.isJsxExpression(child) && child.expression) {
          if (ts.isStringLiteral(child.expression)) text += child.expression.text;
          else { const name = `value${++index}`; text += `{{${name}}}`; bindings[name] = child.expression.getText(source); }
        } else simple = false;
      }
      if (simple) add(text, file, node, source, bindings, 'text');
      for (const child of node.children) if (ts.isJsxExpression(child) && child.expression && !ts.isStringLiteral(child.expression)) {
        if (!/[A-Za-z]/.test(text.replace(/\{\{.*?\}\}/g, ''))) dynamic.push({ file, line: source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1, expression: child.expression.getText(source) });
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if ((ts.isPropertyAssignment(node.parent) && node.parent.name === node) || ts.isLiteralTypeNode(node.parent)) return;
      const attr = attribute(node);
      if (ts.isStringLiteral(node) && /^[A-Z][A-Z_]{2,}$/.test(node.text)) {
        const locations = codes.get(node.text) || [];
        locations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
        codes.set(node.text, locations);
      }
      if (machineAttrs.test(attr)) return;
      const bindings = {}; let text;
      if (ts.isTemplateExpression(node)) {
        text = node.head.text;
        node.templateSpans.forEach((span, i) => { const name = `value${i + 1}`; bindings[name] = span.expression.getText(source); text += `{{${name}}}` + span.literal.text; });
      } else text = node.text;
      add(text, file, node, source, bindings, attrs.has(attr) ? attr : 'candidate');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
walkFiles(path.join(root, 'client/src'));
// Preserve existing reviewed translations under their existing i18next keys.
const resourceFile = path.join(root, 'client/src/i18n/resources.ts');
const compiled = ts.transpileModule(fs.readFileSync(resourceFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {}; new Function('exports', compiled)(exported);
const existing = [];
function flatten(en, ne, prefix = '') {
  for (const [key, value] of Object.entries(en)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') existing.push({ id, en: value, ne: ne?.[key] || '' });
    else flatten(value, ne?.[key], id);
  }
}
flatten(exported.resources.en.translation, exported.resources.ne.translation);
const rows = [...entries.values()].sort((a, b) => a.categories[0].localeCompare(b.categories[0]) || a.en.localeCompare(b.en));
fs.writeFileSync(target, JSON.stringify({ description: 'Review inventory; not yet wired into runtime. Preserve placeholders; names and user content are not translations.', omitted, entries: rows }, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'existing-translations.json'), JSON.stringify(existing, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'dynamic-bindings.json'), JSON.stringify({ description: 'Text expressions requiring a source/code mapping or carrying user data. Never translate raw user data. Review before wiring.', expressions: dynamic, codes: [...codes].map(([code, sources]) => ({ code, label_en: '', label_ne: '', sources })) }, null, 2) + '\n');
const csv = value => '"' + String(value).replaceAll('"', '""') + '"';
fs.writeFileSync(path.join(output, 'ui-copy.csv'), '\uFEFF' + ['ID,Category,English,Nepali,Review,Source', ...rows.map(row => [row.id, row.categories.join('; '), row.en, row.ne, row.review, row.sources.map(s => `${s.file}:${s.line}`).join('; ')].map(csv).join(','))].join('\n') + '\n');
console.log(JSON.stringify({ strings: rows.length, confirmedUI: rows.filter(r => r.review === 'ui').length, reviewCandidates: rows.filter(r => r.review === 'candidate').length, existingTranslations: existing.length, dynamicBindings: dynamic.length, categories: Object.fromEntries([...new Set(rows.flatMap(r => r.categories))].map(group => [group, rows.filter(r => r.categories.includes(group)).length])), omitted }, null, 2));
