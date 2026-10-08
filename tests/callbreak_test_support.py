"""Prepare an established Callbreak deal for tests of later gameplay features."""
def finish_dealer_selection(host, game):
    if game.game_type != 'callbreak':
        return
    while game.state.phase.value == 'SELECTING_DEALER':
        actor = game.state.current_player
        host._apply_player(game, actor, 'PICK_DEALER_CARD', {'position': actor - 1})
        host._apply_controllers(game)
