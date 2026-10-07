import pytest
from pydantic import ValidationError
from app.durable_games.creation_executor import CreateTablePayload
from app.test_games.http import CreateGame
from app.multiplayer.table_creation import table_capacity


@pytest.mark.parametrize('kind,expected', [('marriage',5),('flush',10),('callbreak',4)])
def test_missing_capacity_is_computed_from_game_rules(kind,expected):
    assert table_capacity(kind)==expected
    assert CreateTablePayload(game_type=kind,name='Table').capacity==expected
    assert CreateGame(game_type=kind,name='Table').player_count==expected


@pytest.mark.parametrize('kind,capacity', [('callbreak',4),('callbreak',5),('marriage',2),('marriage',5)])
def test_explicit_supported_rosters_remain_valid(kind,capacity):
    assert CreateTablePayload(game_type=kind,capacity=capacity).capacity==capacity
    assert CreateGame(game_type=kind,player_count=capacity).player_count==capacity


@pytest.mark.parametrize('kind,capacity', [('callbreak',2),('callbreak',3),('callbreak',6),('marriage',1),('marriage',6),('flush',11),('flush',True)])
def test_invalid_rosters_do_not_bypass_rules(kind,capacity):
    with pytest.raises(ValueError):table_capacity(kind,capacity)
    with pytest.raises(ValidationError):CreateTablePayload(game_type=kind,capacity=capacity)
    with pytest.raises(ValidationError):CreateGame(game_type=kind,player_count=capacity)
