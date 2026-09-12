"""Verify the built domain runs without site packages or repository imports.

Usage: python -I -S scripts/verify_marriage_wheel.py path/to/project.whl
"""
from pathlib import Path
import sys
from zipfile import ZipFile


def main():
    if not sys.flags.isolated or not sys.flags.no_site:
        raise SystemExit("Run with python -I -S to disable repository/site-package imports.")
    wheel = Path(sys.argv[1]).resolve()
    with ZipFile(wheel) as archive:
        assert "marriage/engine.py" in archive.namelist()
        assert "card_utils/cards.py" in archive.namelist()
    sys.path.insert(0, str(wheel))
    import marriage
    assert str(wheel) in marriage.__file__
    # Execute only example source; its imports must resolve through the wheel.
    example = Path(__file__).resolve().parents[1] / "examples" / "marriage_round.py"
    namespace = {"__name__": "wheel_example"}
    exec(compile(example.read_text(encoding="utf-8"), str(example), "exec"), namespace)
    game = namespace["run_demo"]()
    marriage.validate_game_state(game.get_state())
    assert game.get_public_view().status is marriage.GameStatus.FINISHED
    assert not any(name.split(".")[0] in {"app", "callbreak", "fastapi", "pydantic"} for name in sys.modules)
    print(f"Wheel-only round passed: winner={game.get_public_view().winner}, revision={game.get_state().revision}")


if __name__ == "__main__":
    main()
