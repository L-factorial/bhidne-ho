"""Scores are integer tenths: 42 means 4.2 points."""


def score_deal(bids: tuple[int, ...], tricks: tuple[int, ...]) -> tuple[int, ...]:
    if len(bids) not in (4, 5) or len(tricks) != len(bids):
        raise ValueError("Provide one bid and trick count per player.")
    maximum = 52 // len(bids)
    if any(type(b) is not int or not 1 <= b <= maximum for b in bids):
        raise ValueError("Invalid bid.")
    if any(type(t) is not int or not 0 <= t <= maximum for t in tricks) or sum(tricks) != maximum:
        raise ValueError("Trick counts must account for the completed deal.")
    return tuple(10 * b + (t - b) if t >= b else -10 * b for b, t in zip(bids, tricks))
