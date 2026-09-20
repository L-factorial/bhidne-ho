from app.multiplayer.chat_names import sender_name, restore_guest_names
from app.multiplayer.player_profiles import PlayerProfileService


async def test_chat_name_awaits_username_hydration_and_prefers_display_name():
    class DatabaseProfiles(PlayerProfileService):
        async def get(self, user_id):
            self.remember_username(user_id, 'database-alice')
            return super().get(user_id)

    profiles = DatabaseProfiles()
    assert await sender_name(profiles, 'alice') == 'database-alice'
    await profiles.update('alice', 'Alice Profile')
    assert await sender_name(profiles, 'alice') == 'Alice Profile'
    assert await sender_name(PlayerProfileService(), 'unnamed-id') == 'unnamed-id'


async def test_history_resolves_each_guest_identity_once_and_preserves_named_messages():
    class CountingProfiles(PlayerProfileService):
        calls = 0

        def get(self, user_id):
            self.calls += 1
            return super().get(user_id)

    profiles = CountingProfiles()
    profiles.remember_username('alice', 'alice-account')
    messages = [{'id': str(i), 'sender_id': 'alice', 'sender_name': 'Guest'} for i in range(3)]
    messages.append({'id': 'named', 'sender_id': 'bob', 'sender_name': 'Bob'})
    repaired = await restore_guest_names(messages, profiles)
    assert [item['sender_name'] for item in repaired] == ['alice-account'] * 3 + ['Bob']
    assert profiles.calls == 1
    assert messages[0]['sender_name'] == 'Guest'
