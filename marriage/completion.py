"""Deterministic winning witnesses using owned physical cards."""
from dataclasses import dataclass
from functools import lru_cache
from itertools import combinations

from .cards import PhysicalCard
from .enums import MeldType, QualificationRoute
from .models import Meld, NormalFinish, PlayerState
from .maal import maal_view
from .rank_policy import sequence_rank_orders
from .rules import MarriageRules


@dataclass(frozen=True)
class Capability:
    supported: bool
    reason: str
    can_finish: bool = False


def completion_meld(cards: tuple[PhysicalCard, ...], tiplu: PhysicalCard,
                    rules: MarriageRules) -> MeldType | None:
    """Classify a final group. Natural qualification still uses melds.py.

    Wildcards: Man, any Tiplu-rank card, and same-suit Jhiplu/Poplu.
    Natural faces may always be used at face value. Sets have 3-4 distinct
    suits; sequences have 3-13 slots, with Ace low or high by policy. All-wild groups are allowed.
    """
    if len(cards) < 3 or len({c.card_id for c in cards}) != len(cards):
        return None
    orders = sequence_rank_orders(rules.ace_sequence)
    natural = all(c.identity is not None for c in cards)
    if natural and len(cards) == 3 and len({c.identity for c in cards}) == 1:
        return MeldType.TUNNELA
    if natural and len({c.suit for c in cards}) == 1:
        for order in orders:
            ranks = sorted(order.index(c.rank) for c in cards)
            if ranks == list(range(ranks[0], ranks[0] + len(cards))):
                return MeldType.PURE_SEQUENCE
    maal = maal_view(tiplu, rules)
    fixed = tuple(c for c in cards if c.identity is not None and c.rank != tiplu.rank
                  and c.identity not in (maal.jhiplu, maal.poplu))
    if len(cards) <= 13 and len({c.suit for c in fixed}) <= 1:
        for order in orders:
            ranks = sorted(order.index(c.rank) for c in fixed)
            if len(set(ranks)) == len(ranks) and (not ranks or ranks[-1] - ranks[0] < len(cards)):
                return MeldType.SEQUENCE
    if (len(cards) <= 4 and len({c.rank for c in fixed}) <= 1
            and len({c.suit for c in fixed}) == len(fixed)):
        return MeldType.SET
    return None


@lru_cache(maxsize=128)
def normal_finish(player: PlayerState, tiplu: PhysicalCard | None,
                  rules: MarriageRules) -> NormalFinish | None:
    """Exact cover of the uncommitted cards, leaving exactly one discard.

    Qualification consumes at least nine cards, so at most thirteen remain.
    Cache only immutable hand/rules inputs; queries never advance state or RNG.
    """
    if (player.folded or player.route is not QualificationRoute.NORMAL or not player.has_seen_maal
            or tiplu is None or len(player.hand) != 22 or len(player.shown_melds) != 3):
        return None
    cards = tuple(sorted((c for c in player.hand if c.card_id not in player.committed_card_ids),
                         key=lambda c: c.card_id))
    candidates = [[] for _ in cards]
    for size in range(3, len(cards)):
        for indices in combinations(range(len(cards)), size):
            group = tuple(cards[i] for i in indices)
            kind = completion_meld(group, tiplu, rules)
            if kind is not None:
                mask = sum(1 << i for i in indices)
                meld = Meld(kind, tuple(c.card_id for c in group))
                for i in indices:
                    candidates[i].append((mask, meld))

    @lru_cache(maxsize=None)
    def cover(mask):
        if mask == 0:
            return ()
        first = (mask & -mask).bit_length() - 1
        for group_mask, meld in candidates[first]:
            if mask & group_mask == group_mask:
                rest = cover(mask ^ group_mask)
                if rest is not None:
                    return (meld,) + rest
        return None

    for index, card in enumerate(cards):
        if any(card.card_id in m.card_ids for m in player.initial_tunnelas):
            continue
        groups = cover(((1 << len(cards)) - 1) ^ (1 << index))
        if groups is not None:
            return NormalFinish(player.shown_melds + groups, card.card_id)
    return None


def eighth_pair(player: PlayerState) -> tuple[str, ...]:
    if player.folded or player.route is not QualificationRoute.DUBLEE or len(player.shown_melds) != 7:
        return ()
    cards = sorted((c for c in player.hand if c.card_id not in player.committed_card_ids
                    and c.identity is not None), key=lambda c: c.card_id)
    for index, left in enumerate(cards):
        for right in cards[index + 1:]:
            if left.identity == right.identity:
                return left.card_id, right.card_id
    return ()


def winning_discard(player: PlayerState, card: PhysicalCard) -> bool:
    """The picked card itself must complete the additional pair."""
    return (player.route is QualificationRoute.DUBLEE and len(player.shown_melds) == 7
            and card.identity is not None
            and any(c.card_id not in player.committed_card_ids and c.identity == card.identity
                    and c.card_id != card.card_id for c in player.hand))


def valid_normal_finish(player: PlayerState, tiplu: PhysicalCard | None,
                        rules: MarriageRules, witness: NormalFinish) -> bool:
    """Validate a selected partition without trusting any client card or meld."""
    if (player.folded or player.route is not QualificationRoute.NORMAL or not player.has_seen_maal
            or tiplu is None or len(player.hand) != 22 or len(player.shown_melds) != 3
            or witness.melds[:3] != player.shown_melds):
        return False
    if any(witness.discard_card_id in m.card_ids for m in player.initial_tunnelas):
        return False
    owned = {c.card_id: c for c in player.hand}
    ids = tuple(i for m in witness.melds for i in m.card_ids)
    if (len(ids) != 21 or len(set(ids)) != 21 or witness.discard_card_id in ids
            or set(ids) | {witness.discard_card_id} != set(owned)):
        return False
    return all(completion_meld(tuple(owned[i] for i in m.card_ids), tiplu, rules) == m.meld_type
               for m in witness.melds[3:])


def valid_eighth_pair(player: PlayerState, pair: tuple[str, ...]) -> bool:
    if (player.route is not QualificationRoute.DUBLEE or not player.has_seen_maal
            or len(player.shown_melds) != 7 or len(pair) != 2 or len(set(pair)) != 2):
        return False
    owned = {c.card_id: c for c in player.hand if c.card_id not in player.committed_card_ids}
    return (all(i in owned and owned[i].identity is not None for i in pair)
            and owned[pair[0]].identity == owned[pair[1]].identity)


def natural_candidates(cards, rules):
    """Enumerate only owned natural runs/Tunnelas, rather than 2**22 subsets."""
    from itertools import product
    faces = {}
    for card in cards:
        if card.identity is not None:
            faces.setdefault((card.suit, card.rank), []).append(card)
    result, seen = [], set()
    def add(kind, held):
        ids = tuple(sorted(c.card_id for c in held))
        if ids not in seen:
            seen.add(ids); result.append(Meld(kind, ids))
    for held in faces.values():
        if len(held) == 3:
            add(MeldType.TUNNELA, held)
    for suit in {c.suit for c in cards if c.identity is not None}:
        for order in sequence_rank_orders(rules.ace_sequence):
            for start in range(len(order)):
                for size in range(3, len(order)-start+1):
                    buckets = [faces.get((suit, rank), ()) for rank in order[start:start+size]]
                    if not all(buckets):
                        break
                    for held in product(*buckets):
                        add(MeldType.PURE_SEQUENCE, held)
    return tuple(sorted(result, key=lambda g:(len(g.card_ids),g.meld_type.value,g.card_ids)))


@lru_cache(maxsize=128)
def unseen_normal_finish(player: PlayerState, rules: MarriageRules) -> NormalFinish | None:
    if (player.folded or player.has_seen_maal or len(player.hand) != 22
            or player.route is QualificationRoute.DUBLEE):
        return None
    cards = tuple(sorted((c for c in player.hand if c.card_id not in player.committed_card_ids),key=lambda c:c.card_id))
    positions = {c.card_id:i for i,c in enumerate(cards)}
    candidates = [[] for _ in cards]
    for group in natural_candidates(cards,rules):
        mask = sum(1<<positions[i] for i in group.card_ids)
        for i in group.card_ids:
            candidates[positions[i]].append((mask,group))
    @lru_cache(maxsize=None)
    def cover(mask):
        if not mask:
            return ()
        first = (mask & -mask).bit_length()-1
        for group_mask,group in candidates[first]:
            if mask & group_mask == group_mask:
                rest = cover(mask ^ group_mask)
                if rest is not None:
                    return (group,)+rest
        return None
    protected = {i for g in player.initial_tunnelas for i in g.card_ids}
    for i,card in enumerate(cards):
        if card.card_id in protected:
            continue
        groups = cover(((1<<len(cards))-1) ^ (1<<i))
        if groups is not None:
            witness = NormalFinish(player.shown_melds+groups,card.card_id)
            if valid_unseen_normal_finish(player,rules,witness):
                return witness
    return None


def valid_unseen_normal_finish(player, rules, witness):
    from .melds import validate_meld
    from .errors import InvalidMeldError
    if (player.folded or player.has_seen_maal or len(player.hand)!=22
            or player.route is QualificationRoute.DUBLEE
            or witness.melds[:len(player.shown_melds)]!=player.shown_melds):
        return False
    ids = tuple(i for group in witness.melds for i in group.card_ids)
    owned = {c.card_id for c in player.hand}
    protected = {i for g in player.initial_tunnelas for i in g.card_ids}
    if (len(ids)!=21 or len(set(ids))!=21 or witness.discard_card_id in ids
            or set(ids)|{witness.discard_card_id}!=owned or witness.discard_card_id in protected):
        return False
    try:
        for group in witness.melds:
            if group.meld_type not in (MeldType.PURE_SEQUENCE,MeldType.TUNNELA):
                return False
            validate_meld(player,group,rules,allow_committed=True)
    except InvalidMeldError:
        return False
    return True


@lru_cache(maxsize=128)
def unseen_dublee_finish(player, rules, player_count):
    if (player_count<4 or player.folded or player.has_seen_maal or len(player.hand)!=22
            or player.route is QualificationRoute.NORMAL):
        return None
    protected = {i for g in player.initial_tunnelas for i in g.card_ids}
    for card in sorted(player.hand,key=lambda c:c.card_id):
        if card.card_id in player.committed_card_ids|protected:
            continue
        faces = {}
        for held in sorted(player.hand,key=lambda c:c.card_id):
            if held.identity is not None and held.card_id not in player.committed_card_ids and held!=card:
                faces.setdefault(held.identity,[]).append(held.card_id)
        pairs = list(player.shown_melds)
        pairs.extend(Meld(MeldType.DUBLEE,tuple(ids[:2])) for ids in faces.values() if len(ids)>=2)
        if len(pairs)>=8:
            chosen = tuple(pairs[:8])
            if valid_unseen_dublee_finish(player,rules,player_count,chosen,card.card_id):
                return chosen,card.card_id
    return None


def valid_unseen_dublee_finish(player,rules,player_count,pairs,discard):
    from .melds import validate_meld
    from .errors import InvalidMeldError
    if (player_count<4 or player.folded or player.has_seen_maal or len(player.hand)!=22
            or player.route is QualificationRoute.NORMAL or len(pairs)!=8
            or tuple(pairs[:len(player.shown_melds)])!=player.shown_melds):
        return False
    ids = tuple(i for g in pairs for i in g.card_ids)
    protected = {i for g in player.initial_tunnelas for i in g.card_ids}
    if (len(ids)!=16 or len(set(ids))!=16 or discard in ids or discard in protected
            or discard not in {c.card_id for c in player.hand}):
        return False
    try:
        for pair in pairs:
            if pair.meld_type is not MeldType.DUBLEE:
                return False
            validate_meld(player,pair,rules,allow_committed=True)
    except InvalidMeldError:
        return False
    return True
