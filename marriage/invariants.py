"""Ownership, startup, and active-turn invariants."""
from dataclasses import replace
from .deck import validate_deck
from .enums import GameStatus, QualificationRoute, TurnPhase
from .errors import CardConservationError, InvalidMeldError
from .events import GameStarted, PlayerFinished, TipluRevealed, TurnChanged
from .completion import eighth_pair, valid_normal_finish, valid_eighth_pair
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
    require(state.tiplu is None and state.winner is None and not state.winning_pair
            and state.normal_finish is None and state.must_finish is False,
            "Startup cannot have an indicator, winner, or forced finish.")
    if state.status is GameStatus.WAITING:
        require(not state.stock and not state.discard and all(not p.hand for p in state.players),
                "Waiting state must not allocate cards.")
        require(state.current_seat is None and state.phase is None,
                "Waiting state must not have an active turn.")
        require(state.revision == 0 and not state.history, "Waiting history must be empty.")
        return
    require(state.status is GameStatus.IN_PROGRESS, "Expected a startup state.")
    require(len(state.discard) == 1, "Initial discard must contain one face-up card.")
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
    """Audit ownership, qualified melds, permissions, turns, history, and both win routes."""
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
    validate_card_conservation(state)
    if state.status is GameStatus.IN_PROGRESS:
        require(state.winner is None and not state.winning_pair and state.normal_finish is None
                and not any(p.finished for p in state.players),
                "Active round cannot have a winner.")
    else:
        require(state.winner == state.current_player_id and state.phase is TurnPhase.MUST_DISCARD
                and tuple(p.player_id for p in state.players if p.finished) == (state.winner,)
                and state.must_finish is False, "Finished round requires exactly one current-seat winner.")
        winner = state.players[state.current_seat]
        require(bool(state.history) and isinstance(state.history[-1], PlayerFinished)
                and state.history[-1].player_id == state.winner
                and state.history[-1].winning_pair == state.winning_pair, "Missing terminal event.")
        event = state.history[-1]
        if winner.route is QualificationRoute.NORMAL:
            witness = state.normal_finish
            require(witness is not None and not state.winning_pair and bool(state.discard),
                    "Normal winner requires a partition and final discard.")
            require(state.discard[-1].card_id == witness.discard_card_id,
                    "Normal final discard must be on top of the discard pile.")
            before = replace(winner, finished=False, hand=winner.hand + (state.discard[-1],))
            require(valid_normal_finish(before, state.tiplu, state.config.rules, witness),
                    "Normal winner requires an exact legal 21-card partition.")
            require(event.meld_types == tuple(m.meld_type for m in witness.melds)
                    and event.card_groups == tuple(m.card_ids for m in witness.melds)
                    and event.discard_card_id == witness.discard_card_id, "Invalid normal finish event.")
        else:
            require(state.normal_finish is None and bool(state.winning_pair)
                    and valid_eighth_pair(winner, state.winning_pair),
                    "Winner requires a separate valid eighth pair.")
            require(not event.meld_types and not event.card_groups and event.discard_card_id is None,
                    "Dublee finish cannot carry a normal partition.")
    require(type(state.must_finish) is bool, "Forced-finish flag must be boolean.")
    if state.must_finish:
        require(state.phase is TurnPhase.MUST_DISCARD and bool(eighth_pair(state.players[state.current_seat])),
                "Forced finish requires a winning hand after drawing.")
    for seat, player in enumerate(state.players):
        extra = int(seat == state.current_seat and state.phase is TurnPhase.MUST_DISCARD
                    and state.normal_finish is None)
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
