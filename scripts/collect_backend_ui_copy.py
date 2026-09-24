"""Collect source-defined server messages and enums; never load runtime/user data.

Run from the repository root. Long text and account/profile modules are excluded.
These are review candidates: not every server exception reaches a screen.
"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'localization'
OUT.mkdir(parents=True, exist_ok=True)
target = OUT / 'server-copy.json'
old = json.loads(target.read_text(encoding='utf8'))['messages'] if target.exists() else []
translations = {row['id']: row['ne'] for row in old}
messages, codes = {}, []
for folder in ('app', 'callbreak', 'flush', 'marriage'):
    for file in sorted((ROOT / folder).rglob('*.py')):
        relative = file.relative_to(ROOT).as_posix()
        if any(part in relative for part in ('/auth/', '/social_auth/', 'player_profile', 'database.py')):
            continue
        source = file.read_text(encoding='utf8')
        tree = ast.parse(source)
        parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and any('Enum' in ast.unparse(base) for base in node.bases):
                for member in node.body:
                    if isinstance(member, ast.Assign) and isinstance(member.value, ast.Constant) and isinstance(member.value.value, str):
                        codes.append({'enum': node.name, 'code': member.value.value, 'label_en': '', 'label_ne': '', 'file': relative, 'line': member.lineno})
            if not isinstance(node, (ast.Constant, ast.JoinedStr)):
                continue
            if isinstance(node, ast.Constant) and not isinstance(node.value, str):
                continue
            if isinstance(parents.get(node), ast.JoinedStr):
                continue
            ancestors, current = [], node
            for _ in range(5):
                current = parents.get(current)
                if current is None:
                    break
                ancestors.append(current)
            call = next((item for item in ancestors if isinstance(item, ast.Call)), None)
            callname = ast.unparse(call.func) if call else ''
            keyword = next((item.arg for item in ancestors if isinstance(item, ast.keyword)), '')
            display = keyword in ('detail', 'reason', 'message', 'label', 'text') or any(name in callname for name in ('Error', 'Exception', 'reject', 'Capability'))
            dictionary = parents.get(node)
            if isinstance(dictionary, ast.Dict):
                display |= any(value is node and isinstance(key, ast.Constant) and key.value in ('detail', 'reason', 'label', 'text', 'message') for key, value in zip(dictionary.keys, dictionary.values))
            if not display:
                continue
            bindings = {}
            if isinstance(node, ast.JoinedStr):
                parts = []
                for child in node.values:
                    if isinstance(child, ast.Constant):
                        parts.append(str(child.value))
                    else:
                        name = f'value{len(bindings) + 1}'
                        bindings[name] = ast.unparse(child.value)
                        parts.append('{{' + name + '}}')
                text = ''.join(parts)
            else:
                text = node.value
            text = ' '.join(text.split())
            if not text or len(text) > 160 or len(text.split()) > 26 or not any(c.islower() for c in text) or len(text.split()) < 2:
                continue
            key = 'server.' + hashlib.sha1(text.encode()).hexdigest()[:12]
            row = messages.setdefault(key, {'id': key, 'en': text, 'ne': translations.get(key, ''), 'sources': []})
            row['sources'].append({'file': relative, 'line': node.lineno, 'call': callname, 'bindings': bindings})
target.write_text(json.dumps({'description': 'Server copy candidates; map stable error/action codes at the UI boundary, never change protocol values or translate user text.', 'messages': sorted(messages.values(), key=lambda row: row['en']), 'enums': codes}, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(f'{len(messages)} server message candidates; {len(codes)} enum values')
