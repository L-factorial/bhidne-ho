from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth.service import InMemoryAuthService
from app.games.echo import EchoCommandTarget, EchoGameEngine
from app.runtime.game_registry import GameRegistry
from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.presence import PresenceService
from app.multiplayer.room_service import RoomService
from app.multiplayer.room_chat import RoomChatService
from app.multiplayer.participation import GameParticipation
from app.multiplayer.room_pokes import RoomPokeService
from app.multiplayer.player_phrases import PlayerPhraseService
from app.multiplayer.player_profiles import PlayerProfileService
from app.runtime.game_runtime import GameRuntime
from app.transport import game_actions, http, room_pokes, websocket, player_profiles, room_chat
from app.test_games.service import TestGameService
from app.test_games.http import router as test_game_router


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        guests = InMemoryAuthService()
        rooms = RoomService()
        connections = ConnectionManager(rooms)
        app.state.guests = guests
        app.state.auth = guests
        app.state.rooms = rooms
        app.state.presence = PresenceService(rooms)
        app.state.connections = connections
        app.state.player_profiles = PlayerProfileService()
        app.state.player_phrases = PlayerPhraseService()
        app.state.room_pokes = RoomPokeService(rooms, connections)
        registry = GameRegistry()
        app.state.game_registry = registry

        def provision_room(room_id: str) -> None:
            # Composition root selects the engine; transport only invokes this hook.
            if registry.get_engine(room_id) is None:
                engine = EchoGameEngine()
                registry.register(room_id, engine, command_target=EchoCommandTarget(engine))

        app.state.provision_room = provision_room
        app.state.runtime = GameRuntime(connections, registry)
        app.state.test_games = TestGameService(rooms, connections, command_runtime=app.state.runtime.commands, profiles=app.state.player_profiles, round_summary_seconds=8)
        app.state.participation = GameParticipation(app.state.test_games)
        app.state.room_chat = RoomChatService(rooms, app.state.player_profiles, app.state.participation)
        try:
            yield
        finally:
            await app.state.test_games.close()
            registry.clear()
        # Uvicorn closes active sockets before lifespan teardown.

    app = FastAPI(title="Bhidne Ho", lifespan=lifespan)
    # Local Expo web clients use a separate origin from the API.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (8081, 8083)],
        allow_methods=["GET", "POST", "DELETE", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(http.router)
    app.include_router(websocket.router)
    app.include_router(game_actions.router)
    app.include_router(room_pokes.router)
    app.include_router(room_chat.router)
    app.include_router(player_profiles.router)
    app.include_router(test_game_router)
    static = Path(__file__).parent / "test_ui"
    app.mount("/test-ui", StaticFiles(directory=static), name="test-ui")

    @app.get("/", include_in_schema=False)
    async def test_console():
        return FileResponse(static / "index.html")

    return app


app = create_app()
