"""Ownership, startup, and active-turn invariants."""
from .deck import validate_deck
from .enums import GameStatus, QualificationRoute, TurnPhase
from .errors import CardConservationError, InvalidMeldError
from .events import GameStarted, PlayerFinished, TipluRevealed, TurnChanged
from .completion import eighth_pair
from .melds import validate_declaration
from .models import MarriageGameState


def validate_card_conservation(state: MarriageGameState) -> None:
    """Audit ownership locations, excluding meld/event references. For dealt rounds."""
    cards = tuple(card for player in state.players for card in player.hand)
    cards += state.stock + state.discard
    if state.tiplu is not None:
        cards += (state.tiplu,)
    validate_deck(cards)


def validate_initial_state(state: MarriageGameState) -> None:
    """Validate WAITING or freshly started state, not later gameplay transitions."""
    def require(condition: bool, message: str) -> None:
        if not condition:
            raise CardConservationError(message)

    require(tuple(p.player_id for p in state.players) == state.config.player_ids,
            "State seats must match configuration order.")
    require(all(p.route == QualificationRoute.UNQUALIFIED and not p.shown_melds
                and not p.committed_card_ids and not p.has_seen_maal and not p.finished
                for p in state.players), "Startup players must be unqualified and unfinished.")
    require(state.tiplu is None and state.winner is None and not state.winning_pair and state.must_finish is False,
            "Startup cannot have an indicator, winner, or forced finish.")
    require(not state.discard, "Initial discard must be empty.")
    if state.status is GameStatus.WAITING:
        require(not state.stock and all(not p.hand for p in state.players),
                "Waiting state must not allocate cards.")
        require(state.current_seat is None and state.phase is None,
                "Waiting state must not have an active turn.")
        require(state.revision == 0 and not state.history, "Waiting history must be empty.")
        return
    require(state.status is GameStatus.IN_PROGRESS, "Expected a startup state.")
    require(type(state.current_seat) is int and 0 <= state.current_seat < len(state.players),
            "Invalid current seat.")
    require(state.current_player_id == state.config.first_player_id
            and state.phase is TurnPhase.MUST_DRAW, "Invalid initial turn.")
    require(all(len(p.hand) == state.config.rules.cards_per_player for p in state.players),
            "Every initial hand must contain 21 cards.")
    validate_card_conservation(state)
    expected = (
        GameStarted(1, 1, state.config.player_ids, state.config.rules.cards_per_player),
        TurnChanged(2, 1, state.config.first_player_id, TurnPhase.MUST_DRAW),
    )
    require(state.revision == 1 and state.history == expected, "Invalid startup history.")


def validate_game_state(state: MarriageGameState) -> None:
    """Audit ownership, qualified melds, permissions, turns, history, and Dublee completion."""
    if state.status is GameStatus.WAITING:
        validate_initial_state(state)
        return

    def require(condition: bool, message: str) -> None:
        if not condition:
            raise CardConservationError(message)

    require(state.status in (GameStatus.IN_PROGRESS, GameStatus.FINISHED), "Expected an allocated round.")
    require(tuple(p.player_id for p in state.players) == state.config.player_ids,
            "State seats must match configuration order.")
    require(type(state.current_seat) is int and 0 <= state.current_seat < len(state.players),
            "Invalid current seat.")
    require(isinstance(state.phase, TurnPhase), "Invalid turn phase.")
    if state.status is GameStatus.IN_PROGRESS:
        require(state.winner is None and not state.winning_pair and not any(p.finished for p in state.players),
                "Active round cannot have a winner.")
    else:
        require(state.winner == state.current_player_id and state.phase is TurnPhase.MUST_DISCARD
                and tuple(p.player_id for p in state.players if p.finished) == (state.winner,)
                and state.must_finish is False, "Finished round requires exactly one current-seat winner.")
        require(bool(state.winning_pair) and state.winning_pair == eighth_pair(state.players[state.current_seat]),
                "Winner requires a separate valid eighth pair.")
        require(isinstance(state.history[-1], PlayerFinished)
                and state.history[-1].player_id == state.winner
                and state.history[-1].winning_pair == state.winning_pair, "Missing terminal event.")
    require(type(state.must_finish) is bool, "Forced-finish flag must be boolean.")
    if state.must_finish:
        require(state.phase is TurnPhase.MUST_DISCARD and bool(eighth_pair(state.players[state.current_seat])),
                "Forced finish requires a winning hand after drawing.")
    validate_card_conservation(state)
    for seat, player in enumerate(state.players):
        extra = int(seat == state.current_seat and state.phase is TurnPhase.MUST_DISCARD)
        require(len(player.hand) == state.config.rules.cards_per_player + extra,
                "Hands must contain 21 cards, or 22 for the player who drew.")
        shown = tuple(card_id for meld in player.shown_melds for card_id in meld.card_ids)
        require(len(set(shown)) == len(shown) and set(shown) == player.committed_card_ids
                and player.committed_card_ids <= {card.card_id for card in player.hand},
                "Shown cards must be disjoint, committed, and owned.")
        require(isinstance(player.route, QualificationRoute), "Invalid qualification route.")
        if player.route is QualificationRoute.UNQUALIFIED:
            require(not shown and not player.has_seen_maal, "Unqualified player cannot show melds or see Maal.")
        else:
            require(bool(shown) and player.has_seen_maal and state.tiplu is not None,
                    "Qualified player requires shown melds and Maal access.")
            try:
                validate_declaration(player, player.shown_melds, player.route, state.config.rules,
                                     allow_committed=True)
            except InvalidMeldError as error:
                raise CardConservationError("Qualified melds are invalid.") from error
    if state.tiplu is not None:
        require(state.tiplu.identity is not None and any(p.has_seen_maal for p in state.players),
                "Indicator must be a standard card with an authorized player.")
    require(type(state.revision) is int and state.revision >= 1 and bool(state.history),
            "Active round requires revisioned history.")
    previous_revision = 0
    for sequence, event in enumerate(state.history, start=1):
        require(event.sequence == sequence and event.revision in (previous_revision, previous_revision + 1)
                and event.revision >= 1, "Invalid event ordering.")
        previous_revision = event.revision
    require(previous_revision == state.revision, "History must end at the current revision.")
    indicators = tuple(e.card for e in state.history if isinstance(e, TipluRevealed))
    require(len(indicators) <= 1 and (not indicators or indicators[0] == state.tiplu),
            "Round indicator must remain stable.")
