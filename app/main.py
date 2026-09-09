from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth.service import InMemoryAuthService
from app.games.echo import EchoGameEngine
from app.runtime.game_registry import GameRegistry
from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.presence import PresenceService
from app.multiplayer.room_service import RoomService
from app.runtime.game_runtime import GameRuntime
from app.transport import http, websocket


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
        registry = GameRegistry()
        app.state.game_registry = registry

        def provision_room(room_id: str) -> None:
            # Composition root selects the engine; transport only invokes this hook.
            if registry.get_engine(room_id) is None:
                registry.register(room_id, EchoGameEngine())

        app.state.provision_room = provision_room
        app.state.runtime = GameRuntime(connections, registry)
        try:
            yield
        finally:
            registry.clear()
        # Uvicorn closes active sockets before lifespan teardown.

    app = FastAPI(title="Bhidne Ho", lifespan=lifespan)
    app.include_router(http.router)
    app.include_router(websocket.router)
    static = Path(__file__).parent / "test_ui"
    app.mount("/test-ui", StaticFiles(directory=static), name="test-ui")

    @app.get("/", include_in_schema=False)
    async def test_console():
        return FileResponse(static / "index.html")

    return app


app = create_app()
