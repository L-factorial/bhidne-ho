"""Temporary testing policy. Uses only one seat's safe view and public discard."""
from collections import defaultdict
from itertools import combinations, product


def suggestions(hand):
    faces = defaultdict(list)
    for card in hand:
        if card['card_type'] == 'standard':
            faces[(card['suit'], 1 if card['rank'] == 14 else card['rank'])].append(card['card_id'])
    pairs, candidates = [], []
    for ids in faces.values():
        if len(ids) >= 2:
            pairs.append({'meld_type': 'dublee', 'card_ids': ids[:2]})
        if len(ids) == 3:
            candidates.append({'meld_type': 'tunnela', 'card_ids': ids[:]})
    for suit in 'SCHD':
        for rank in range(1, 12):
            for ids in product(*(faces[(suit, r)] for r in range(rank, rank + 3))):
                candidates.append({'meld_type': 'pure_sequence', 'card_ids': list(ids)})
    normal = next((list(groups) for groups in combinations(candidates, 3)
                   if len({i for g in groups for i in g['card_ids']}) == 9), [])
    return pairs[:7] if len(pairs) >= 7 else [], normal


def choose_move(view):
    actions, hand = view['actions'], view['hand']
    if 'finish' in actions['kinds']:
        return 'FINISH', {}
    sources = actions['drawable_sources']
    if sources:
        top = view['public']['top_discard']
        useful = top and any(c['rank'] == top['rank'] and c['suit'] == top['suit'] for c in hand)
        source = 'discard' if 'discard' in sources and useful else 'stock' if 'stock' in sources else sources[0]
        return 'DRAW_CARD', {'source': source}
    pairs, normal = suggestions(hand)
    if pairs and 'show_dublees' in actions['kinds']:
        return 'SHOW_DUBLEES', {'pairs': pairs}
    if normal and 'show_initial_melds' in actions['kinds']:
        return 'SHOW_INITIAL_MELDS', {'melds': normal}
    ids = actions['discardable_card_ids']
    if ids:
        # Keep matching faces and nearby suited cards; never inspect another hand.
        def value(card):
            return sum(5 if c['rank'] == card['rank'] and c['suit'] == card['suit'] else
                       1 if c['suit'] == card['suit'] and c['rank'] and card['rank'] and abs(c['rank'] - card['rank']) <= 2 else 0
                       for c in hand if c['card_id'] != card['card_id'])
        card = min((c for c in hand if c['card_id'] in ids), key=value)
        return 'DISCARD_CARD', {'card_id': card['card_id']}
    return None
