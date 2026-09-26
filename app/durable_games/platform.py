"""Reviewed shared account/profile routes; never mount legacy game/social writers."""
from fastapi import APIRouter, Depends

from app.multiplayer.player_profiles import PostgresPlayerProfileService
from app.players.service import PlayerSocialService, PlayerNotFound
from app.players.store import PostgresPlayerStore
from .checkpoint_store import user_uuid


class PlatformPlayers(PlayerSocialService):
    # Gateway-local caches cannot serve authoritative profiles after another
    # gateway updates them. Directory/search/public reads always consult SQL.
    async def public_player(self, target_id):
        try:
            user_uuid(target_id)
        except ValueError:
            raise PlayerNotFound('Player not found.') from None
        return await self.store.get_player(target_id)

    async def search(self, user_id, query):
        return await self.store.search(user_id, query)


class SharedPlatform:
    def __init__(self, pool, auth, *, guest_login_enabled=False):
        if type(guest_login_enabled) is not bool:
            raise ValueError('Guest login selection must be boolean.')
        self.auth = auth
        self.profiles = PostgresPlayerProfileService(pool)
        from app.multiplayer.player_phrases import PostgresPlayerPhraseService
        self.phrases = PostgresPlayerPhraseService(pool)
        self.players = PlatformPlayers(PostgresPlayerStore(pool))
        self.guest_login_enabled = guest_login_enabled
        from app.social_auth.browser import BrowserSocialAuth
        from app.social_auth.browser_store import PostgresBrowserAttempts
        from app.social_auth.store import PostgresSocialIdentityStore
        self.browser = BrowserSocialAuth.from_environment(PostgresBrowserAttempts(pool),
            PostgresSocialIdentityStore(pool, auth, self.profiles))

    def install(self, app, admission):
        from app.transport import http, player_profiles, room_pokes
        from app.players import http as players
        from app.social_auth import browser_http
        app.state.auth = app.state.guests = self.auth
        app.state.player_profiles = self.profiles
        app.state.player_phrases = self.phrases
        app.state.players = self.players
        app.state.guest_login_enabled = self.guest_login_enabled
        app.state.browser_social_auth = self.browser
        router = APIRouter()
        # Exact method/path contracts, not an entire legacy router or prefix.
        reviewed = (
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
