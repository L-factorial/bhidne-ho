// Disposable one-deal client simulation. Never use this as an authoritative game engine.
export type TestPlay = { player: number; card: string };
export type TestDeal = {
  hands: string[][]; bids: number[]; tricks: number[]; plays: TestPlay[];
  turn: number; trick: number; complete: boolean; lastWinner: number | null;
};
const suits = ['♣', '♦', '♥', '♠'];
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const suit = (card: string) => card.slice(-1);
const rank = (card: string) => ranks.indexOf(card.slice(0, -1)) + 2;
const strength = (card: string, led: string) => (suit(card) === '♠' ? 200 : suit(card) === led ? 100 : 0) + rank(card);

export function winningPlay(plays: TestPlay[]): TestPlay {
  return plays.reduce((winner, play) => strength(play.card, suit(plays[0].card)) > strength(winner.card, suit(plays[0].card)) ? play : winner);
}

export function legalChoices(hand: string[], plays: TestPlay[]): string[] {
  if (!plays.length) return hand;
  const led = suit(plays[0].card), winningStrength = strength(winningPlay(plays).card, led);
  const following = hand.filter(card => suit(card) === led);
  if (following.length) {
    const beating = following.filter(card => strength(card, led) > winningStrength);
    return beating.length ? beating : following;
  }
  const trumping = hand.filter(card => suit(card) === '♠' && strength(card, led) > winningStrength);
  return trumping.length ? trumping : hand;
}

export function chooseCard(hand: string[], plays: TestPlay[]): string {
  return [...legalChoices(hand, plays)].sort((a, b) =>
    Number(suit(a) === '♠') - Number(suit(b) === '♠') || rank(a) - rank(b) || suits.indexOf(suit(a)) - suits.indexOf(suit(b)))[0];
}

export function createTestDeal(capacity: 4 | 5, random = Math.random): TestDeal {
  const deck = suits.flatMap(s => ranks.map(r => r + s));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const size = Math.floor(52 / capacity);
  const hands = Array.from({ length: capacity }, (_, i) => deck.slice(i * size, (i + 1) * size));
  const bids = hands.map(hand => Math.max(1, Math.min(size,
    hand.filter(card => rank(card) === 14 || suit(card) === '♠' && rank(card) >= 11).length)));
  return { hands, bids, tricks: Array(capacity).fill(0), plays: [], turn: 0, trick: 1, complete: false, lastWinner: null };
}

export function stepTestDeal(state: TestDeal): TestDeal {
  if (state.complete) return state;
  // Retain a completed trick for one timer tick so every played card can be seen.
  if (state.plays.length === state.hands.length) {
    return { ...state, plays: [], trick: state.trick + 1, lastWinner: null };
  }
  const card = chooseCard(state.hands[state.turn], state.plays);
  const hands = state.hands.map((hand, index) => index === state.turn ? hand.filter(value => value !== card) : hand);
  const plays = [...state.plays, { player: state.turn, card }];
  if (plays.length < hands.length) return { ...state, hands, plays, turn: (state.turn + 1) % hands.length };
  const winner = winningPlay(plays).player;
  return { ...state, hands, plays, turn: winner, lastWinner: winner,
    tricks: state.tricks.map((count, index) => count + Number(index === winner)), complete: hands.every(hand => hand.length === 0) };
}
