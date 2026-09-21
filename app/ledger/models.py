from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GameLedgerAmount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_id: str = Field(min_length=1, max_length=128)
    amount: int


class GameLedgerResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    room_id: str
    table_id: str
    table_name: str = Field(default="", max_length=60)
    game_id: str
    game_type: str
    amounts: list[GameLedgerAmount] = Field(min_length=2)

    @model_validator(mode="after")
    def balanced(self):
        if len({row.player_id for row in self.amounts}) != len(self.amounts):
            raise ValueError("A player may occur only once in a game result.")
        if sum(row.amount for row in self.amounts) != 0:
            raise ValueError("Game ledger results must be zero-sum.")
        return self


class CreateSettlement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: Literal["game", "table"]
    table_id: str = Field(min_length=1, max_length=128)
    game_id: str | None = Field(default=None, max_length=128)
    idempotency_key: str = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def valid_scope(self):
        if (self.scope == "game") != (self.game_id is not None):
            raise ValueError("game_id is required only for game settlement.")
        return self


class SettlementAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=128)
