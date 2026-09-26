"""Opt-in route factory. Never imported or mounted by the legacy application."""
import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.auth.service import AuthenticationError
from .checkpoint_store import user_uuid
from .checkpoints import Record
from .inbox import InboxRequest, LaneTarget
from .queries import QueryAccessDenied
from .store import DurableGameConflict, DurableGameNotFound
from .delivery_store import client_identity, sequence
from .socket_session import SocketSession


class Submission(Record):
    target: LaneTarget
    body: InboxRequest


def create_router(*, auth, hosted, chat, social, gateway, allowed_origins, reads=None, catalog=None,
                  presence=None, presence_room=None, admission=None,
                  session_check_interval=5.0, session_check_timeout=2.0):
    """All dependencies are explicit; origins is an exact allowlist for browsers.

    Non-browser clients may omit Origin. Authentication still requires a bearer
    token; client IDs and subscription aliases never supply actor authority.
    """
    if (presence is None) != (presence_room is None):
        raise ValueError('Presence requires an authorized room resolver.')
    router = APIRouter(prefix='/distributed', dependencies=[Depends(admission)] if admission else [])
    origins = frozenset(allowed_origins)

    async def actor(token):
        identity = await auth.authenticate(token)
        user_uuid(identity.user_id)
        return identity.user_id

    async def http_actor(request):
        header = request.headers.get('authorization', '')
        if not header.startswith('Bearer '):
            raise HTTPException(401, 'Authentication required.')
        try:
            async with asyncio.timeout(5):
                return await actor(header[7:])
        except AuthenticationError:
            raise HTTPException(401, 'Authentication required.') from None

    async def execute(operation):
        try:
            async with asyncio.timeout(10):
                result = await operation()
            return JSONResponse(jsonable_encoder(result), headers={'Cache-Control': 'no-store'})
        except QueryAccessDenied:
            raise HTTPException(403, 'Access denied.') from None
        except DurableGameNotFound:
            raise HTTPException(404, 'Command or scope unavailable.') from None
        except DurableGameConflict:
            raise HTTPException(409, 'Command conflicts with durable state.') from None
        except (ValueError, TypeError):
            raise HTTPException(422, 'Invalid distributed request.') from None
        except TimeoutError:
            # Timeout says nothing about whether the transaction committed.
            raise HTTPException(503, 'Outcome unknown; retain the original command ID.') from None

    @router.post('/commands')
    async def submit(request: Request):
        who = await http_actor(request)
        async def work():
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 65536:
                    raise HTTPException(413, 'Command envelope exceeds limit.')
            data = Submission.model_validate_json(bytes(raw))
            ingress = hosted if data.target.kind in ('room', 'table', 'game') else (
                chat if data.target.kind in ('room_chat', 'table_chat', 'game_chat') else social)
            return await ingress.submit(who, data.target, data.body.model_dump(mode='json'))
        return await execute(work)

    @router.get('/commands/{lane_id}/{command_id}')
    async def status(request: Request, lane_id: UUID, command_id: str):
        who = await http_actor(request)
        # Actor-only inbox status is generic across all supported lanes.
        return await execute(lambda: hosted.status(who, lane_id, command_id))

    if catalog is not None:
        @router.post('/rooms')
        async def create_room(request: Request):
            who = await http_actor(request)
            async def work():
                from .catalog import CreateRoom
                raw = bytearray()
                async for chunk in request.stream():
                    raw.extend(chunk)
                    if len(raw) > 65536:
                        raise HTTPException(413, 'Room creation exceeds limit.')
                body = CreateRoom.model_validate_json(bytes(raw))
                return await catalog.create(who, body.model_dump(mode='json'))
            return await execute(work)

    if reads is not None:
        @router.get('/rooms')
        async def catalog_page(request: Request, after_room_id: str = Query('', max_length=128),
                               limit: int = Query(50, ge=1, le=100)):
            who = await http_actor(request)
            return await execute(lambda: reads.hosted.catalog(who, after_room_id=after_room_id, limit=limit))

        @router.get('/room-invitations')
        async def room_invitations(request: Request, after_id: str = Query('', max_length=128),
                                   limit: int = Query(50, ge=1, le=100)):
            who = await http_actor(request)
            return await execute(lambda: reads.hosted.room_invitations(who, after_id=after_id, limit=limit))

        @router.get('/table-invitations')
        async def table_invitations(request: Request, after_table_id: UUID | None = None,
                                    limit: int = Query(50, ge=1, le=100)):
            who = await http_actor(request)
            return await execute(lambda: reads.hosted.invitations(who, after_table_id=after_table_id, limit=limit))

        @router.get('/rooms/{room_id}/members')
        async def members(request: Request, room_id: str, after_user_id: str | None = Query(None, max_length=128),
                          limit: int = Query(100, ge=1, le=100)):
            who = await http_actor(request)
            return await execute(lambda: reads.hosted.members(room_id, who, after_user_id=after_user_id, limit=limit))

        @router.get('/rooms/{room_id}/ledger')
        async def ledger(request: Request, room_id: str):
            who = await http_actor(request)
            return await execute(lambda: reads.ledger.snapshot(room_id, who))

        @router.get('/rooms/{room_id}')
        async def room(request: Request, room_id: str, table_id: UUID | None = None):
            who = await http_actor(request)
            return await execute(lambda: reads.hosted.room(room_id, who, table_id=table_id))

        @router.post('/streams/recipient')
        async def recipient(request: Request):
            who = await http_actor(request)
            return await execute(lambda: reads.recipient(who))

        @router.post('/streams/open')
        async def open_stream(request: Request):
            who = await http_actor(request)
            async def work():
                raw = bytearray()
                async for chunk in request.stream():
                    raw.extend(chunk)
                    if len(raw) > 4096:
                        raise HTTPException(413, 'Stream target exceeds limit.')
                target = LaneTarget.model_validate_json(bytes(raw))
                return await reads.open(who, target)
            return await execute(work)

        @router.get('/streams/social')
        async def social_streams(request: Request, after: UUID | None = None, limit: int = Query(50, ge=1, le=100)):
            who = await http_actor(request)
            return await execute(lambda: reads.social.streams(who, after=after, limit=limit))

        @router.get('/history/{family}/{lane_id}')
        async def history(request: Request, family: str, lane_id: UUID,
                          after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)):
            who = await http_actor(request)
            if family not in ('chat', 'social'):
                raise HTTPException(422, 'Invalid history family.')
            reader = reads.chat if family == 'chat' else reads.social
            return await execute(lambda: reader.page(who, lane_id, after=after, limit=limit))

        @router.get('/legacy/{family}')
        async def legacy(request: Request, family: str, other: str | None = None,
                         before_at: str | None = None, before_id: UUID | None = None,
                         limit: int = Query(100, ge=1, le=100)):
            who = await http_actor(request)
            if (before_at is None) != (before_id is None):
                raise HTTPException(422, 'Supply both legacy cursor fields.')
            before = dict(at=before_at, id=str(before_id)) if before_id else None
            if family == 'direct' and other:
                return await execute(lambda: reads.social.legacy_direct(who, other, before=before, limit=limit))
            if family == 'notifications' and other is None:
                return await execute(lambda: reads.social.legacy_notifications(who, before=before, limit=limit))
            raise HTTPException(422, 'Invalid legacy scope.')

    @router.websocket('/delivery')
    async def delivery(socket: WebSocket):
        origin = socket.headers.get('origin')
        if origin is not None and origin not in origins:
            await socket.close(code=1008)
            return
        handles = {}
        disconnected = False
        session = None
        connection_presence = None
        room_presence, alias_rooms = {}, {}
        async def remove_room(alias):
            room = alias_rooms.pop(alias, None)
            if room is not None and room not in alias_rooms.values():
                await presence.detach(room_presence.pop(room))
        send_lock = asyncio.Lock()
        async def send(value):
            async with asyncio.timeout(3):
                async with send_lock:
                    if session is not None:
                        await session.check()
                    await socket.send_json(value)
        async def frame(timeout):
            async with asyncio.timeout(timeout):
                raw = await socket.receive_text()
            if len(raw.encode()) > 65536:
                raise ValueError('Frame too large.')
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError('Expected an object.')
            return data
        try:
            await socket.accept()
            data = await frame(5)
            if set(data) != {'type', 'token', 'client_id'} or data['type'] != 'AUTH' or not isinstance(data['token'], str):
                raise ValueError('Authentication frame required.')
            client = data['client_id']
            client_identity(client)
            session = SocketSession(actor, data['token'], asyncio.current_task(),
                interval=session_check_interval, timeout=session_check_timeout)
            who = await session.check()
            session.start()
            if presence is not None:
                connection_presence = presence.attach(who)
            await send({'type': 'READY'})
            while True:
                data = await frame(45)
                await session.check()
                kind = data.get('type')
                if kind == 'PING' and set(data) == {'type'}:
                    await send({'type': 'PONG'})
                    continue
                alias = data.get('subscription_id')
                if not isinstance(alias, str) or not 1 <= len(alias) <= 128:
                    raise ValueError('Invalid subscription alias.')
                if kind == 'SUBSCRIBE' and set(data) == {'type', 'subscription_id', 'lane_id'}:
                    if alias in handles or len(handles) >= 128:
                        raise ValueError('Subscription limit or duplicate alias.')
                    lane = UUID(data['lane_id'])
                    async def page(value, alias=alias):
                        await send(dict(value, subscription_id=alias))
                    async def revoked(reason, alias=alias):
                        handles.pop(alias, None)
                        await remove_room(alias)
                        await send({'type': 'STREAM_CLOSED', 'subscription_id': alias})
                    handle = await gateway.subscribe(who, client, lane, page, on_close=revoked, paused=True)
                    handles[alias] = handle
                    if presence is not None:
                        async with asyncio.timeout(3):
                            room = await presence_room(who, lane)
                        if room is not None:
                            if room not in room_presence:
                                room_presence[room] = presence.attach(who, room_id=room)
                            alias_rooms[alias] = room
                    await send({'type': 'SUBSCRIBED', 'subscription_id': alias, 'lane_id': str(lane),
                                'cursor': gateway.subscription_cursor(handle)})
                    gateway.activate(handle)
                elif kind == 'ACK' and set(data) == {'type', 'subscription_id', 'scanned_sequence'}:
                    if alias not in handles:
                        raise ValueError('Unknown subscription.')
                    sequence(data['scanned_sequence'])
                    cursor = await gateway.acknowledge(handles[alias], data['scanned_sequence'])
                    await send({'type': 'ACKED', 'subscription_id': alias, 'scanned_sequence': data['scanned_sequence'],
                                'cursor': cursor})
                elif kind == 'UNSUBSCRIBE' and set(data) == {'type', 'subscription_id'}:
                    handle = handles.pop(alias, None)
                    if handle is not None:
                        gateway.unsubscribe(handle)
                    await remove_room(alias)
                else:
                    raise ValueError('Invalid delivery operation.')
        except WebSocketDisconnect:
            disconnected = True
        except asyncio.CancelledError:
            try:
                async with asyncio.timeout(3):
                    await socket.close(code=session.close_code if session and session.close_code else 1012)
            except (RuntimeError, WebSocketDisconnect, TimeoutError):
                pass
            if session is None or session.close_code is None:
                raise
            disconnected = True
        except (AuthenticationError, ValueError, TypeError, KeyError, QueryAccessDenied):
            await socket.close(code=1008)
            disconnected = True
        except (TimeoutError, RuntimeError):
            await socket.close(code=1011)
            disconnected = True
        finally:
            for handle in handles.values():
                gateway.unsubscribe(handle)
            async def cleanup():
                if session is not None:
                    await session.stop()
                if presence is not None:
                    for entry in tuple(room_presence.values()):
                        await presence.detach(entry)
                    if connection_presence is not None:
                        await presence.detach(connection_presence)
            from .delivery import _join_cleanup
            try:
                await _join_cleanup(asyncio.create_task(cleanup(), name='socket-session-cleanup'))
            except asyncio.CancelledError:
                if not disconnected:
                    raise
    return router
