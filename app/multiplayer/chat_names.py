"""Resolve chat identity consistently with game seats, including stored profiles."""
from inspect import isawaitable


async def sender_name(profiles, user_id):
    profile = profiles.get(user_id)
    if isawaitable(profile):
        profile = await profile
    # Database get() hydrates both the display name and account username.
    return profile['display_name'] or profiles.name(user_id, None)


async def restore_guest_names(messages, profiles):
    names = {}
    result = []
    for message in messages:
        if not message.get('sender_name') or message['sender_name'] == 'Guest':
            user_id = message['sender_id']
            if user_id not in names:
                names[user_id] = await sender_name(profiles, user_id)
            message = {**message, 'sender_name': names[user_id]}
        result.append(message)
    return result
