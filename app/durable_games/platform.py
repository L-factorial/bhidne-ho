"""Reviewed shared account/profile routes; never mount legacy game/social writers."""
from fastapi import APIRouter, Depends

from app.multiplayer.player_profiles import PostgresPlayerProfileService
from app.players.service import PlayerSocialService, PlayerNotFound
from app.players.store import PostgresPlayerStore
from .checkpoint_store import user_uuid
from .platform_cache import CachedProfiles, CachedPlayers


class PlatformPlayers(PlayerSocialService):
    # Bypass the legacy unversioned dictionary; the store checks committed versions.
    async def public_player(self, target_id):
        try:
            user_uuid(target_id)
        except ValueError:
            raise PlayerNotFound('Player not found.') from None
        return await self.store.get_player(target_id)

    async def search(self, user_id, query):
        return await self._unblocked(user_id, await self.store.search(user_id, query))

    async def directory_search(self, user_id, query):
        return await self._unblocked(user_id, await super().directory_search(user_id, query))

    async def _unblocked(self, user_id, players):
        if not players:
            return players
        async with self.store.pool.connection() as connection:
            rows = await (await connection.execute(
                'SELECT id FROM users WHERE id=ANY(%s::uuid[]) AND NOT social_blocked(%s,id)',
                ([str(user_uuid(p['user_id'])) for p in players], user_uuid(user_id)))).fetchall()
        allowed = {f'user-{row[0]}' for row in rows}
        return [p for p in players if p['user_id'] in allowed]


class SharedPlatform:
    def __init__(self, pool, auth, *, guest_login_enabled=False, cache=None):
        if type(guest_login_enabled) is not bool:
            raise ValueError('Guest login selection must be boolean.')
        from app.auth.recovery_delivery import RecoveryRuntime
        self.recovery = RecoveryRuntime.from_environment(pool, auth)
        from app.player_blocks.service import BlockService
        self.blocks = BlockService(pool)
        self.auth = auth
        self.profiles = CachedProfiles(pool, cache) if cache else PostgresPlayerProfileService(pool)
        from app.multiplayer.player_phrases import PostgresPlayerPhraseService
        self.phrases = PostgresPlayerPhraseService(pool)
        self.players = PlatformPlayers(CachedPlayers(pool, cache) if cache else PostgresPlayerStore(pool))
        self.guest_login_enabled = guest_login_enabled
        from app.social_auth.browser import BrowserSocialAuth
        from app.social_auth.browser_store import PostgresBrowserAttempts
        from app.social_auth.store import PostgresSocialIdentityStore
        self.browser = BrowserSocialAuth.from_environment(PostgresBrowserAttempts(pool),
            PostgresSocialIdentityStore(pool, auth, self.profiles))

        from app.account_deletion.runtime import DeletionRuntime
        self.deletion = DeletionRuntime(pool,self.recovery,self.browser,cache=cache,profiles=self.profiles)

    def install(self, app, admission):
        from app.auth import recovery_http
        from app.account_deletion import http as deletion_http
        from app.transport import http, player_profiles, room_pokes
        from app.players import http as players
        from app.social_auth import browser_http
        from app.player_blocks import http as block_http
        app.state.blocks = self.blocks
        app.state.recovery = self.recovery
        app.state.deletion = self.deletion
        app.state.auth = app.state.guests = self.auth
        app.state.player_profiles = self.profiles
        app.state.player_phrases = self.phrases
        app.state.players = self.players
        app.state.guest_login_enabled = self.guest_login_enabled
        app.state.browser_social_auth = self.browser
        router = APIRouter()
        # Exact method/path contracts, not an entire legacy router or prefix.
        reviewed = (
            (block_http.router, block_http.CONTRACTS),
            (recovery_http.router, recovery_http.CONTRACTS),
            (deletion_http.router, deletion_http.CONTRACTS),
            (http.router, {('POST', '/auth/guest'), ('POST', '/auth/signup'),
                           ('POST', '/auth/signin'), ('POST', '/auth/signout'), ('GET', '/auth/me')}),
            (player_profiles.router, {('GET', '/me/profile'), ('PATCH', '/me/profile'),
                ('GET', '/me/profile/appearance'), ('PATCH', '/me/profile/appearance')}),
            (players.router, {('GET', '/players/search'), ('GET', '/players/directory'),
                              ('GET', '/players/{player_id}'), ('GET', '/friends')}),
            (room_pokes.router, {('GET', '/me/phrases'), ('POST', '/me/phrases'),
                ('PATCH', '/me/phrases/{phrase_id}'), ('DELETE', '/me/phrases/{phrase_id}')}),
            (browser_http.router, {('GET', '/auth/social/browser/providers'),
                ('POST', '/auth/social/browser/{provider}/start'),
                ('GET', '/auth/social/browser/{provider}/callback'),
                ('POST', '/auth/social/browser/{provider}/callback'),
                ('POST', '/auth/social/browser/complete')}),
        )
        for source, contracts in reviewed:
            selected = [route for route in source.routes
                        if any((method, route.path) in contracts for method in route.methods)]
            if {(method, route.path) for route in selected for method in route.methods} != contracts:
                raise RuntimeError('Shared route contract changed; compatibility review required.')
            router.routes.extend(selected)
        app.include_router(router, dependencies=[Depends(admission)])
        return tuple(router.routes)
