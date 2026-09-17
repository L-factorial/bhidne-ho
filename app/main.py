from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth.service import InMemoryAuthService
from app.auth.postgres import PostgresAuthService
from app.database import Database
from app.games.echo import EchoCommandTarget, EchoGameEngine
from app.runtime.game_registry import GameRegistry
from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.lifecycle import RoomLifecycle
from app.multiplayer.presence import PresenceService
from app.multiplayer.room_service import RoomService
from app.multiplayer.room_catalog import PostgresRoomCatalog
from app.multiplayer.room_chat import RoomChatService
from app.multiplayer.participation import GameParticipation
from app.multiplayer.room_pokes import RoomPokeService
from app.multiplayer.player_phrases import PlayerPhraseService
from app.multiplayer.player_profiles import PlayerProfileService, PostgresPlayerProfileService
from app.runtime.game_runtime import GameRuntime
from app.transport import game_actions, http, room_pokes, websocket, player_profiles, room_chat
from app.test_games.service import TestGameService
from app.test_games.http import router as test_game_router
from app.social_auth.config import SocialAuthConfig
from app.social_auth.http import router as social_auth_router
from app.social_auth.service import SocialAuthService
from app.social_auth.store import InMemorySocialIdentityStore, PostgresSocialIdentityStore
from app.social_auth.verifiers import configured_verifiers
from app.players.http import router as players_router
from app.players.service import PlayerSocialService
from app.players.store import InMemoryPlayerStore, PostgresPlayerStore


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database_url = os.environ.get("BHIDNE_HO_DATABASE_URL") or os.environ.get("DATABASE_URL")
        database = Database(database_url) if database_url else None
        if database:
            await database.open()
        guests = PostgresAuthService(database.pool) if database else InMemoryAuthService()
        rooms = RoomService(PostgresRoomCatalog(database.pool) if database else None)
        connections = ConnectionManager(rooms)
        app.state.guests = guests
        app.state.auth = guests
        app.state.rooms = rooms
        app.state.presence = PresenceService(rooms)
        app.state.connections = connections
        app.state.database = database
        app.state.player_profiles = PostgresPlayerProfileService(database.pool) if database else PlayerProfileService()
        app.state.players = PlayerSocialService(
            PostgresPlayerStore(database.pool) if database else InMemoryPlayerStore(app.state.player_profiles),
        )
        social_store = (PostgresSocialIdentityStore(database.pool, guests, app.state.player_profiles)
                        if database else InMemorySocialIdentityStore(guests, app.state.player_profiles))
        app.state.social_auth = SocialAuthService(
            configured_verifiers(SocialAuthConfig.from_environment()), social_store,
        )
        app.state.player_phrases = PlayerPhraseService()
        app.state.room_pokes = RoomPokeService(rooms, connections, app.state.player_profiles)
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
        app.state.lifecycle = RoomLifecycle(rooms, connections, app.state.test_games, app.state.players)
        app.state.participation = GameParticipation(app.state.test_games)
        app.state.room_chat = RoomChatService(rooms, app.state.player_profiles, app.state.participation)
        try:
            yield
        finally:
            await app.state.test_games.close()
            registry.clear()
            if database:
                await database.close()
        # Uvicorn closes active sockets before lifespan teardown.

    app = FastAPI(title="Bhidne Ho", lifespan=lifespan)
    # Hosted static frontend origins are explicitly configured; local Expo remains supported.
    origins = [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (8081, 8083)]
    cors_origins = os.environ.get("BHIDNE_HO_CORS_ORIGINS") or os.environ.get("BHIDNE_CORS_ORIGINS", "")
    origins.extend(origin.strip().rstrip("/") for origin in cors_origins.split(",") if origin.strip())
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "DELETE", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(http.router)
    app.include_router(social_auth_router)
    app.include_router(players_router)
    app.include_router(websocket.router)
    app.include_router(game_actions.router)
    app.include_router(room_pokes.router)
    app.include_router(room_chat.router)
    app.include_router(player_profiles.router)
    app.include_router(test_game_router)
    static = Path(__file__).parent / "test_ui"
    app.mount("/test-ui", StaticFiles(directory=static), name="test-ui")

    web_dir = os.environ.get("BHIDNE_WEB_DIR")
    if web_dir:
        web = Path(web_dir)
        if not (web / "index.html").is_file():
            raise RuntimeError("BHIDNE_WEB_DIR must contain the exported frontend index.html")
        # API and WebSocket routes must precede this catch-all static mount.
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    else:
        @app.get("/", include_in_schema=False)
        async def test_console():
            return FileResponse(static / "index.html")

    return app


app = create_app()
