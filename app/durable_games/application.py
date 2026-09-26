"""Isolated ASGI bootstrap for distributed integration, never the production default.

Use a dedicated integration database and preconfigured resources/authenticator.
This boundary excludes legacy writers from this app, not from other processes.
Mixed-version access to the same database is not a supported deployment.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Match
from starlette.datastructures import MutableHeaders


class NativeProtocolOnly:
    """Reject legacy HTTP/WS routes before any route dependency can run."""
    def __init__(self, app, shared_routes=()):
        self.app = app
        self.shared_routes = shared_routes

    async def __call__(self, scope, receive, send):
        if scope['type'] in ('http', 'websocket'):
            path = scope.get('path', '')
            native = path == '/distributed' or path.startswith('/distributed/')
            health = scope['type'] == 'http' and path == '/health'
            shared = scope['type'] == 'http' and any(
                route.matches(scope)[0] == Match.FULL for route in self.shared_routes)
            if not native and not health and not shared:
                if scope['type'] == 'websocket':
                    await send({'type': 'websocket.close', 'code': 1008,
                                'reason': 'Distributed protocol required.'})
                else:
                    await JSONResponse({'detail': 'This integration app only supports the distributed protocol.',
                                        'code': 'unsupported_runtime_route'}, status_code=409)(scope, receive, send)
                return
            if shared:
                async def private_send(message):
                    if message['type'] == 'http.response.start':
                        MutableHeaders(scope=message)['Cache-Control'] = 'no-store'
                    await send(message)
                await self.app(scope, receive, private_send)
                return
        await self.app(scope, receive, send)


def create_integration_app(server):
    if server is None or server.state != 'new':
        raise ValueError('Supply a fresh distributed server assembly.')

    @asynccontextmanager
    async def lifespan(app):
        try:
            await server.start()
            yield
        finally:
            # Includes failures before startup completes. Stop is idempotent and
            # retains owned resources if component shutdown cannot be confirmed.
            await server.stop()

    app = FastAPI(title='Bhidne Ho distributed integration', lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runtime_mode = 'distributed-integration'
    app.state.distributed_server = server
    app.include_router(server.router)
    platform = getattr(server, 'platform', None)
    shared_routes = platform.install(app, server.admission) if platform is not None else ()

    @app.get('/health')
    async def health():
        ready = server.state == 'running'
        return JSONResponse({'status': 'ok' if ready else 'unavailable',
                             'runtime': 'distributed-integration'}, status_code=200 if ready else 503)

    app.add_middleware(NativeProtocolOnly, shared_routes=shared_routes)
    app.add_middleware(CORSMiddleware, allow_origins=list(server.allowed_origins),
                       allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Authorization', 'Content-Type'])
    return app
