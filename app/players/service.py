import time
from collections import OrderedDict


class PlayerNotFound(Exception): pass
class FriendshipConflict(Exception): pass
class FriendshipDenied(Exception): pass
class DirectMessageRateLimited(Exception): pass


class PlayerSocialService:
    def __init__(self, store, profile_cache_capacity=10_000, negative_ttl_seconds=45):
        self.store = store
        self.last_message = {}
        self.clock = time.monotonic
        self.profile_cache_capacity = profile_cache_capacity
        self.negative_ttl_seconds = negative_ttl_seconds
        self.profile_cache = OrderedDict()
        self.missing_profiles = {}

    @staticmethod
    def _remember(cache, key, value, capacity):
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > capacity:
            cache.popitem(last=False)

    def _cache_profile(self, player):
        self._remember(self.profile_cache, player["user_id"], player, self.profile_cache_capacity)
        self.missing_profiles.pop(player["user_id"], None)

    async def ensure_user(self, user_id):
        await self.store.ensure_user(user_id)

    async def refresh_player(self, user_id):
        self._cache_profile(await self.store.get_player(user_id))

    async def search(self, user_id, query):
        needle = query.casefold()
        matches = [player for target_id, player in self.profile_cache.items()
                   if target_id != user_id and
                   (needle in (player.get("display_name") or "").casefold()
                    or needle in (player.get("username") or "").casefold())]
        matches.sort(key=lambda player: (
            (player.get("username") or "").casefold() != needle,
            (player.get("display_name") or "").casefold(),
            (player.get("username") or "").casefold(),
        ))
        for player in matches[:20]:
            self.profile_cache.move_to_end(player["user_id"])
        return matches[:20]

    async def player(self, user_id, target_id):
        if user_id == target_id:
            raise PlayerNotFound("Player not found.")
        return await self.public_player(target_id)

    async def public_player(self, target_id):
        cached = self.profile_cache.get(target_id)
        if cached:
            self.profile_cache.move_to_end(target_id)
            return cached
        missing_at = self.missing_profiles.get(target_id)
        if missing_at is not None and self.clock() - missing_at < self.negative_ttl_seconds:
            raise PlayerNotFound("Player not found.")
        try:
            player = await self.store.get_player(target_id)
        except PlayerNotFound:
            self.missing_profiles[target_id] = self.clock()
            raise
        self._cache_profile(player)
        return player

    async def directory_search(self, user_id, query):
        if query.startswith("user-"):
            try: return [await self.player(user_id, query)]
            except PlayerNotFound: return []
        results = await self.store.find_exact(user_id, query)
        for player in results:
            self._cache_profile(player)
        return results

    async def snapshot(self, user_id):
        return await self.store.snapshot(user_id)

    async def are_friends(self, user_id, other_id):
        return await self.store.are_friends(user_id, other_id)

    async def request_friend(self, user_id, target_id):
        if user_id == target_id:
            raise FriendshipConflict("You cannot send a friend request to yourself.")
        return await self.store.request_friend(user_id, target_id)

    async def accept(self, user_id, requester_id):
        return await self.store.accept(user_id, requester_id)

    async def remove(self, user_id, other_id):
        return await self.store.remove(user_id, other_id)

    async def notifications(self, user_id):
        return await self.store.notifications_for(user_id)

    async def read_notifications(self, user_id):
        return await self.store.read_notifications(user_id)

    async def history(self, user_id, friend_id):
        return await self.store.history(user_id, friend_id)

    async def send(self, user_id, friend_id, text):
        now = self.clock()
        key = (user_id, friend_id)
        if now - self.last_message.get(key, float("-inf")) < 1:
            raise DirectMessageRateLimited("Wait a moment before sending another message.")
        message = await self.store.send(user_id, friend_id, text)
        self.last_message[key] = now
        return message
