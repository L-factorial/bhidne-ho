import time


class PlayerNotFound(Exception): pass
class FriendshipConflict(Exception): pass
class FriendshipDenied(Exception): pass
class DirectMessageRateLimited(Exception): pass


class PlayerSocialService:
    def __init__(self, store):
        self.store = store
        self.last_message = {}
        self.clock = time.monotonic

    async def ensure_user(self, user_id):
        await self.store.ensure_user(user_id)

    async def search(self, user_id, query):
        return await self.store.search(user_id, query)

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
