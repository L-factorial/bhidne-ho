"""Round-labelled action history from the adapter's public event projection."""


def flush_action_history(events):
    round_number = 1
    history = []
    seen = set()
    bets = {}
    kinds = {
        "BOOT_COLLECTED", "BET_PLACED", "CARDS_SEEN", "PLAYER_FOLDED",
        "SHOW_REQUESTED", "SIDE_SHOW_REQUESTED", "SIDE_SHOW_ACCEPTED",
        "SIDE_SHOW_DECLINED", "SIDE_SHOW_RESOLVED", "ROUND_FINISHED",
    }
    for event in events:
        if event["kind"] == "ROUND_STARTED":
            round_number += 1
            seen.clear()
            bets.clear()
        if event["kind"] not in kinds:
            continue
        player_id = event.get("player_id")
        if event["kind"] == "CARDS_SEEN":
            seen.add(player_id)
        if event["kind"] == "BET_PLACED":
            bets[player_id] = bets.get(player_id, 0) + 1
        # Explicit fields: private or later-added card payloads never flow into
        # this timeline, including a side-show comparison visible to two seats.
        history.append({
            "sequence": event["sequence"], "revision": event["revision"],
            "round_number": round_number, "kind": event["kind"],
            "player_id": event.get("player_id"), "amount": event.get("amount", 0),
            "target_player_id": event.get("target_player_id"),
            "loser_player_id": event.get("loser_player_id"),
            "winner_ids": list(event.get("winner_ids", ())),
            "visibility": ("seen" if player_id in seen else "blind") if player_id else None,
            "bet_number": bets[player_id] if event["kind"] == "BET_PLACED" else None,
        })
    return history
