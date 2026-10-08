"""Shared cosmetic table setting, authorized from authoritative dealer state."""
from typing import Literal
from pydantic import BaseModel, ConfigDict

CardThemeId = Literal['kathmandu', 'everest', 'boudhanath', 'pokhara', 'pashupatinath',
                      'chitwan', 'bhaktapur', 'rara', 'lumbini', 'annapurna']
DEFAULT_CARD_THEME = 'kathmandu'


class CardThemePayload(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    card_theme: CardThemeId


def card_theme_controller(game):
    occupied = {u for u in game.table.seats(game) if u is not None}
    occupied.difference_update(game.departed | game.pending_flush_departures)
    if game.ended or not occupied:
        return None
    dealer = None
    if game.game_type == 'callbreak' and game.state is not None:
        state = game.state
        if state.phase.value == 'SELECTING_DEALER':
            return next((user for user in game.users if user in occupied), None)
        context = state.preparation or state.current_deal or (state.completed_deals[-1].deal if state.completed_deals else None)
        seat = context.dealer if context else state.initial_dealer
        if 1 <= seat <= len(game.users):
            dealer = game.users[seat - 1]
    elif game.game_type == 'flush' and game.flush_target is not None:
        seat = game.flush_target.adapter.checkpoint().get_state().config.dealer_id
        dealer = next((user for user, number in game.flush_seats.items() if str(number) == seat), None)
    if dealer in occupied:
        return dealer
    # Marriage has no dealer role. Also handles pregame and a departed dealer.
    return next((user for user in game.users if user in occupied), None)


def card_theme_view(game, actor):
    controller = card_theme_controller(game)
    return dict(card_theme=game.card_theme, card_theme_controller_id=controller,
                can_change_card_theme=controller is not None and controller == actor)


def set_card_theme(game, actor, theme):
    if game.ended:
        return 'This table has ended.'
    if card_theme_controller(game) != actor or actor is None:
        return 'Only the current dealer, or the designated seated player when no dealer is available, can change the card theme.'
    if game.card_theme != theme:
        game.card_theme = theme
        game.table.emit('CARD_THEME_CHANGED', card_theme=theme, user_id=actor)
    return None
