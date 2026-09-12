"""Display names keyed by authenticated identity, separate from login credentials."""

class PlayerProfileService:
    def __init__(self):
        self.names: dict[str, str] = {}

    def get(self, user_id):
        return {"display_name": self.names.get(user_id, "")}

    def update(self, user_id, display_name):
        self.names[user_id] = display_name
        return self.get(user_id)

    def name(self, user_id, seat):
        return self.names.get(user_id) or f"Player {seat}"
