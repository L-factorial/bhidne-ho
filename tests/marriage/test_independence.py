import ast
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]


def test_marriage_imports_only_own_package_card_utils_and_standard_library():
    allowed = sys.stdlib_module_names | {'card_utils', 'marriage'}
    for path in (*((ROOT / 'marriage').glob('*.py')), *((ROOT / 'card_utils').glob('*.py'))):
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
            if isinstance(node, ast.Import):
                assert all(alias.name.split('.')[0] in allowed for alias in node.names), path
            if isinstance(node, ast.ImportFrom) and node.level == 0:
                assert node.module.split('.')[0] in allowed, path


def test_foundation_runs_with_site_packages_disabled(tmp_path):
    code = '''
import sys
sys.path.insert(0, sys.argv[1])
from marriage import create_deck, validate_deck, MarriageConfig
from marriage import MarriageGameEngine, DrawSource, validate_card_conservation
from random import Random
validate_deck(create_deck())
assert len(MarriageConfig(['p1', 'p2', 'p3', 'p4']).player_ids) == 4
engine = MarriageGameEngine(['p1', 'p2', 'p3', 'p4'], rng=Random(11))
engine.start_game()
validate_card_conservation(engine.get_state())
assert len(engine.get_player_view('p1').hand) == 21
assert engine.get_public_view().stock_count == 75
engine.draw_card('p1', DrawSource.STOCK)
engine.discard_card('p1', engine.get_allowed_actions('p1').discardable_card_ids[0])
validate_card_conservation(engine.get_state())
assert engine.get_public_view().current_player_id == 'p2'
assert not any(name.split('.')[0] in {'app', 'callbreak', 'fastapi', 'pydantic'} for name in sys.modules)
'''
    result = subprocess.run([sys.executable, '-I', '-S', '-c', code, str(ROOT)],
                            cwd=tmp_path, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
