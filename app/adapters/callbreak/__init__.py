"""Call Break adapter contracts, full dispatch, and event translation."""

from .contracts import (
    CommandName, CommandRejected, ControllerAction, EventName, OutboundEvent, PlayerCommand,
    RoutedEvent, parse_player_command,
)
from .adapter import AdapterResult, dispatch_player, dispatch_control
from .preparation import PreparationResult, control_preparation, dispatch_preparation

__all__ = ["CommandName", "CommandRejected", "ControllerAction", "EventName", "OutboundEvent",
           "PlayerCommand", "RoutedEvent", "parse_player_command",
           "AdapterResult", "dispatch_player", "dispatch_control", "PreparationResult", "control_preparation", "dispatch_preparation"]
