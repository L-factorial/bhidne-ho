"""Marriage protocol, transactional adapter, and shared-runtime registration."""
from .adapter import AdapterResult, MarriageAdapter
from .contracts import (COMMAND_SPECS, EVENT_SPECS, CommandName, CommandRejected,
                        EventName, OutboundEvent, PlayerCommand, RoutedEvent, parse_player_command)
from .host import MarriageCommandTarget, register_marriage

__all__ = ["AdapterResult", "MarriageAdapter", "COMMAND_SPECS", "EVENT_SPECS", "CommandName",
           "CommandRejected", "EventName", "OutboundEvent", "PlayerCommand", "RoutedEvent",
           "parse_player_command", "MarriageCommandTarget", "register_marriage"]
