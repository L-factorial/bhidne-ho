"""Standalone transactional facade for startup and draw/discard turns."""
from collections.abc import Sequence
from dataclasses import replace
from random import Random

from .deck import create_deck, deal_cards
from .enums import DrawSource, GameStatus, QualificationRoute, TurnPhase
from .errors import InvalidActionError, InvalidTurnError, NoDrawableCardError, UnsupportedRuleError
from .events import (ActionResult, CardDiscarded, CardDrawn, DiscardPileRecycled,
                     DomainEvent, GameStarted, MeldsShown, PlayerFinished, PlayerSawMaal,
                     TipluRevealed, TurnChanged)
from .invariants import validate_game_state, validate_initial_state
from .models import MarriageConfig, MarriageGameState, Meld, PlayerState
from .cards import PhysicalCard
from .completion import Capability, NORMAL_COMPLETION, eighth_pair
from .maal import MaalView, maal_view, select_tiplu
from .melds import validate_declaration, validate_meld
from .visibility import VisibleEvent, visible_events
from .queries import AllowedActions, PlayerView, PublicGameView, allowed_actions, player_view, public_view
from .rules import MarriageRules
from .turns import discardable_ids, draw_source_block, find_player, recycle_discards


class MarriageGameEngine:
    """Single-threaded standalone round API; callers serialize actions for this instance.

    Mutation results and get_state() are trusted. Use player/public projections
    for external consumers. See docs/marriage.md for the complete rules contract.
    """
    def __init__(self, player_ids: Sequence[str], *, rules: MarriageRules | None = None,
                 rng: Random | None = None, first_player_id: str | None = None):
        config = MarriageConfig(player_ids, rules if rules is not None else MarriageRules(),
                                first_player_id)
        if rng is not None and not isinstance(rng, Random):
            raise ValueError("rng must be a random.Random instance.")
        self._rng = Random()
        if rng is not None:
            self._rng.setstate(rng.getstate())
        self._state = MarriageGameState(config, tuple(PlayerState(p) for p in config.player_ids))
        validate_initial_state(self._state)

    def start_game(self) -> ActionResult:
        """Shuffle and deal once, entering MUST_DRAW; reject repeated startup."""
        if self._state.status is not GameStatus.WAITING:
            raise InvalidActionError("Game has already started.")
        staged_rng = Random()
        staged_rng.setstate(self._rng.getstate())
        deck = list(create_deck())
        staged_rng.shuffle(deck)
        config = self._state.config
        hands, stock = deal_cards(tuple(deck), len(config.player_ids), config.rules.cards_per_player)
        events = (
            GameStarted(1, 1, config.player_ids, config.rules.cards_per_player),
            TurnChanged(2, 1, config.first_player_id, TurnPhase.MUST_DRAW),
        )
        candidate = MarriageGameState(
            config=config,
            players=tuple(PlayerState(player_id, hand) for player_id, hand in zip(config.player_ids, hands)),
            stock=stock, current_seat=config.player_ids.index(config.first_player_id),
            phase=TurnPhase.MUST_DRAW, status=GameStatus.IN_PROGRESS, revision=1, history=events,
        )
        validate_initial_state(candidate)
        result = ActionResult(candidate.revision, events)
        self._rng = staged_rng
        self._state = candidate
        return result

    def get_state(self) -> MarriageGameState:
        """Trusted diagnostic state. Use safe views for players or spectators."""
        return self._state

    def _require_turn(self, player_id: str, phase: TurnPhase, *, finishing: bool = False) -> PlayerState:
        player = find_player(self._state, player_id)
        if self._state.status is not GameStatus.IN_PROGRESS:
            raise InvalidActionError("Game is not in progress.")
        if self._state.current_player_id != player_id:
            raise InvalidTurnError("It is another player's turn.")
        if self._state.phase is not phase or (self._state.must_finish and not finishing):
            raise InvalidActionError("Action is unavailable in this turn phase.")
        return player

    def _commit_turn(self, candidate: MarriageGameState, events: tuple[DomainEvent, ...],
                     rng: Random | None = None) -> ActionResult:
        candidate = replace(candidate, revision=self._state.revision + 1,
                            history=self._state.history + events)
        validate_game_state(candidate)
        result = ActionResult(candidate.revision, events)
        if rng is not None:
            self._rng = rng
        self._state = candidate
        return result

    def draw_card(self, player_id: str, source: DrawSource) -> ActionResult:
        """Take one stock/discard card, with atomic recycling and winning-discard policy."""
        player = self._require_turn(player_id, TurnPhase.MUST_DRAW)
        if not isinstance(source, DrawSource):
            raise InvalidActionError("Source must be a DrawSource enum value.")
        reason = draw_source_block(self._state, player, source)
        if reason:
            if source is DrawSource.STOCK or not self._state.discard:
                raise NoDrawableCardError(reason)
            raise InvalidActionError(reason)
        stock, discard = self._state.stock, self._state.discard
        revision, sequence = self._state.revision + 1, len(self._state.history) + 1
        events = []
        staged_rng = None
        if source is DrawSource.STOCK:
            if not stock:
                staged_rng = Random(0)
                staged_rng.setstate(self._rng.getstate())
                stock, discard = recycle_discards(discard, staged_rng)
                events.append(DiscardPileRecycled(sequence, revision, len(stock)))
            card, stock = stock[-1], stock[:-1]
        else:
            card, discard = discard[-1], discard[:-1]
        events.append(CardDrawn(sequence + len(events), revision, player_id, source, card))
        players = tuple(replace(p, hand=p.hand + (card,)) if p.player_id == player_id else p
                        for p in self._state.players)
        forced = (source is DrawSource.DISCARD and player.route is QualificationRoute.DUBLEE
                  and not self._state.config.rules.dublee_player_can_draw_discard)
        candidate = replace(self._state, players=players, stock=stock, discard=discard,
                            phase=TurnPhase.MUST_DISCARD, must_finish=forced)
        return self._commit_turn(candidate, tuple(events), staged_rng)

    def discard_card(self, player_id: str, card_id: str) -> ActionResult:
        """Throw an owned, uncommitted card and advance one seat in configured order."""
        player = self._require_turn(player_id, TurnPhase.MUST_DISCARD)
        if not isinstance(card_id, str) or card_id not in discardable_ids(self._state, player):
            raise InvalidActionError("Card must be owned and uncommitted.")
        card = next(card for card in player.hand if card.card_id == card_id)
        hand = tuple(card for card in player.hand if card.card_id != card_id)
        players = tuple(replace(p, hand=hand) if p.player_id == player_id else p for p in self._state.players)
        next_seat = (self._state.current_seat + 1) % len(players)
        revision, sequence = self._state.revision + 1, len(self._state.history) + 1
        events = (
            CardDiscarded(sequence, revision, player_id, card),
            TurnChanged(sequence + 1, revision, players[next_seat].player_id, TurnPhase.MUST_DRAW),
        )
        candidate = replace(self._state, players=players, discard=self._state.discard + (card,),
                            current_seat=next_seat, phase=TurnPhase.MUST_DRAW)
        return self._commit_turn(candidate, events)

    def get_allowed_actions(self, player_id: str) -> AllowedActions:
        """Return legal moves and declaration submission windows, not automatic meld discovery."""
        return allowed_actions(self._state, player_id)

    def validate_meld(self, player_id: str, meld: Meld) -> Meld:
        """Pure ownership/natural-meld check; raises InvalidMeldError on rejection."""
        return validate_meld(find_player(self._state, player_id), meld, self._state.config.rules)

    def validate_initial_melds(self, player_id: str, melds: Sequence[Meld]) -> tuple[Meld, ...]:
        """Preview exactly three sequences/Tunnelas. Does not grant permission or check turn."""
        return validate_declaration(find_player(self._state, player_id), melds,
                                    QualificationRoute.NORMAL, self._state.config.rules)

    def validate_dublees(self, player_id: str, pairs: Sequence[Meld]) -> tuple[Meld, ...]:
        """Preview exactly seven disjoint natural pairs without changing the round."""
        return validate_declaration(find_player(self._state, player_id), pairs,
                                    QualificationRoute.DUBLEE, self._state.config.rules)

    def show_initial_melds(self, player_id: str, melds: Sequence[Meld]) -> ActionResult:
        """Qualify through exactly three pure sequences/Tunnelas, atomically granting Maal."""
        return self._show(player_id, melds, QualificationRoute.NORMAL)

    def show_dublees(self, player_id: str, pairs: Sequence[Meld]) -> ActionResult:
        """Qualify through exactly seven natural pairs; no route switching is permitted."""
        return self._show(player_id, pairs, QualificationRoute.DUBLEE)

    def _show(self, player_id: str, melds: Sequence[Meld], route: QualificationRoute) -> ActionResult:
        player = self._require_turn(player_id, TurnPhase.MUST_DISCARD)
        if player.route is not QualificationRoute.UNQUALIFIED:
            raise InvalidActionError("Player has already qualified; routes cannot be changed.")
        values = validate_declaration(player, melds, route, self._state.config.rules)
        tiplu, stock, discard = self._state.tiplu, self._state.stock, self._state.discard
        created = tiplu is None
        rng = None
        recycled = 0
        if created:
            rng = Random(0)
            rng.setstate(self._rng.getstate())
            tiplu, stock, discard, recycled = select_tiplu(stock, discard, rng)
        events = []
        seq, rev = len(self._state.history) + 1, self._state.revision + 1
        if recycled:
            events.append(DiscardPileRecycled(seq, rev, recycled))
        events.append(MeldsShown(seq + len(events), rev, player_id, route,
                                tuple(m.meld_type for m in values), tuple(m.card_ids for m in values)))
        if created:
            events.append(TipluRevealed(seq + len(events), rev, tiplu))
        events.append(PlayerSawMaal(seq + len(events), rev, player_id))
        qualified = replace(player, route=route, shown_melds=values,
                            committed_card_ids=frozenset(i for m in values for i in m.card_ids),
                            has_seen_maal=True)
        players = tuple(qualified if p.player_id == player_id else p for p in self._state.players)
        return self._commit_turn(replace(self._state, players=players, tiplu=tiplu, stock=stock,
                                         discard=discard), tuple(events), rng)

    def has_eighth_dublee(self, player_id: str) -> bool:
        """Pure query; excludes the fourteen committed cards. Does not imply it is your turn."""
        return bool(eighth_pair(find_player(self._state, player_id)))

    def can_finish_normal_hand(self, player_id: str) -> Capability:
        """Explicit unsupported capability, never a fabricated winning-hand verdict."""
        find_player(self._state, player_id)
        return NORMAL_COMPLETION

    def finish(self, player_id: str) -> ActionResult:
        """Finish a validated Dublee round, preserving all 22 owned cards and six leftovers."""
        player = self._require_turn(player_id, TurnPhase.MUST_DISCARD, finishing=True)
        if player.route is QualificationRoute.NORMAL:
            raise UnsupportedRuleError(NORMAL_COMPLETION.reason)
        pair = eighth_pair(player)
        if not pair:
            raise InvalidActionError("Finish requires seven committed Dublees and a separate eighth pair.")
        players = tuple(replace(p, finished=True) if p.player_id == player_id else p for p in self._state.players)
        event = PlayerFinished(len(self._state.history) + 1, self._state.revision + 1, player_id, pair)
        return self._commit_turn(replace(self._state, players=players, status=GameStatus.FINISHED,
                                         winner=player_id, winning_pair=pair, must_finish=False), (event,))

    def can_see_maal(self, player_id: str) -> bool:
        """Check qualification-based entitlement without revealing indicator information."""
        return find_player(self._state, player_id).has_seen_maal

    def get_maal(self, player_id: str) -> MaalView | None:
        """Read Tiplu/Jhiplu/Poplu natural faces only for an entitled seat."""
        if not self.can_see_maal(player_id):
            return None
        return maal_view(self._state.tiplu, self._state.config.rules)

    def read_last_card(self) -> PhysicalCard | None:
        """Read the current visible discard top, or None when the pile is empty."""
        return self._state.discard[-1] if self._state.discard else None

    def get_public_events(self, after_sequence: int = 0) -> tuple[VisibleEvent, ...]:
        """Spectator-safe events newer than the cursor; hidden cards are redacted."""
        return visible_events(self._state, None, after_sequence)

    def get_player_events(self, player_id: str, after_sequence: int = 0) -> tuple[VisibleEvent, ...]:
        """History filtered using this seat's current entitlement; raw history remains trusted."""
        find_player(self._state, player_id)
        return visible_events(self._state, player_id, after_sequence)

    def get_public_view(self) -> PublicGameView:
        """Spectator-safe current state, with counts instead of hidden hands and stock."""
        return public_view(self._state)

    def get_player_view(self, player_id: str) -> PlayerView:
        """Public state plus this seat's hand, action options, and entitled Maal faces."""
        return player_view(self._state, player_id)
