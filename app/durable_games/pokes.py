"""Short-lived poke presentation over the durable table outbox, without engine edits."""
from typing import Annotated
from uuid import uuid5, NAMESPACE_URL
from pydantic import Field
from app.models.poke import PlayerPhraseInput
from app.runtime.command_runtime import OutgoingEvent
from .checkpoint_store import user_uuid
from .checkpoints import canonical_json
from .executor import ExecutionResult
from .outbox import append_lane_events
from .queries import require_member, QueryAccessDenied
from .recovery import rebuild_hosted_game


class Poke(PlayerPhraseInput):
    recipient_player_id: Annotated[int, Field(strict=True, ge=1)] | None = None


async def execute(claim, checkpoints):
    from .table_executor import _LobbyHost
    request, actor, connection = claim.entry.request, claim.entry.actor_id, claim.connection
    stored = await checkpoints.load_for_update(connection, claim.target.table_id)
    data = stored.checkpoint['data']
    host = _LobbyHost(8)
    game = host.game = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot).game
    detail = None
    try:
        await require_member(connection, claim.target.room_id, actor)
        poke = Poke.model_validate_json(canonical_json(request.payload))
        if game.ended or request.match_id != game.match_id or request.expected_revision != data['table_revision']:
            raise ValueError('The table changed. Reopen it before sending a poke.')
        users = game.table.next_seats if game.table.next_seats is not None else game.users
        seats = {u: game.flush_seats[u] if game.game_type == 'flush' else index+1
                 for index,u in enumerate(users) if u is not None and u not in game.departed}
        if actor not in seats:
            raise QueryAccessDenied('Take a seat before sending a poke.')
        recipient = next((u for u,seat in seats.items() if seat == poke.recipient_player_id),None)
        if poke.recipient_player_id is not None and (recipient is None or recipient == actor):
            raise ValueError('Choose another occupied seat.')
        timing = await (await connection.execute('''SELECT clock_timestamp(),created_at+interval '15 seconds'>clock_timestamp()
            FROM command_inbox WHERE lane_id=%s AND sequence=%s''',(claim.entry.lane_id,claim.entry.sequence))).fetchone()
        if not timing[1]:
            raise ValueError('This poke expired before it could be sent.')
        recent = await (await connection.execute('''SELECT 1 FROM command_inbox WHERE lane_id=%s AND actor_id=%s
            AND command='send-poke' AND status='accepted' AND completed_at>clock_timestamp()-interval '1.5 seconds' LIMIT 1''',
            (claim.entry.lane_id,actor))).fetchone()
        if recent:
            raise ValueError('Give that poke a moment before sending another.')
    except (ValueError,QueryAccessDenied) as error:
        detail = str(error)
    outcome=dict(command_id=request.command_id,status='rejected' if detail else 'accepted',revision=data['table_revision'])
    events=[]
    if detail:
        outcome['detail']=detail
    else:
        row=await (await connection.execute('''SELECT COALESCE(NULLIF(p.display_name,''),a.username)
            FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN account_credentials a ON a.user_id=u.id WHERE u.id=%s''',(user_uuid(actor),))).fetchone()
        event=dict(type='ROOM_POKE',id=uuid5(NAMESPACE_URL,canonical_json([str(claim.entry.lane_id),actor,request.command_id])).hex,
            room_id=claim.target.room_id,match_id=game.match_id,sender_id=actor,sender_player_id=seats[actor],
            sender_name=(row[0] if row else None) or f'Player {seats[actor]}',recipient_id=recipient,
            recipient_player_id=poke.recipient_player_id,scope='private' if recipient else 'table',text=poke.text,
            expires_at=int(timing[0].timestamp()*1000)+5000)
        events.append(OutgoingEvent(event,recipient))
    events.append(OutgoingEvent(dict(type='TABLE_COMMAND_ACK',**outcome),actor))
    await append_lane_events(claim,events)
    await claim.complete(outcome)
    return ExecutionResult(claim.entry.lane_id,claim.entry.sequence,outcome)
