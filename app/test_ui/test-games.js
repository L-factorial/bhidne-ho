'use strict';
let testGame = null, testGameBusy = false, testGameRefreshing = false;
let testGameDeadline = null, testGameSignature = '';
const suitSymbols = {C: '♣', D: '♦', H: '♥', S: '♠'};
const gameConnected = () => !!activeRoom && socket?.readyState === WebSocket.OPEN;
const scoreText = value => value === null || value === undefined ? '—' : (value / 10).toFixed(1);

function resetTestGame() {
  testGame = null; testGameDeadline = null; testGameSignature = '';
  renderTestGame();
}
function acceptTestSnapshot(data) {
  if (!gameConnected() || data.room_id !== activeRoom.room_id) return;
  if (testGame?.match_id === data.match_id) {
    if ((data.game?.revision ?? 0) < (testGame.game?.revision ?? 0)) return;
    if (data.status === 'waiting' && (data.players?.length ?? 0) < (testGame.players?.length ?? 0)) return;
  }
  testGame = data;
  testGameDeadline = data.remaining_ms == null ? null : performance.now() + data.remaining_ms;
  renderTestGame();
}
async function refreshTestGame() {
  if (!gameConnected() || testGameRefreshing) return;
  const room = activeRoom, credential = session, connection = socket;
  testGameRefreshing = true;
  try {
    const data = await api(`/test-games/${encodeURIComponent(room.room_id)}`, undefined, credential);
    if (activeRoom === room && socket === connection && session === credential) acceptTestSnapshot(data);
  } catch (error) { if (activeRoom === room) feedback(error.message); }
  finally { testGameRefreshing = false; }
}
async function testGameRequest(suffix, body) {
  if (!gameConnected() || testGameBusy) return;
  const room = activeRoom, credential = session, connection = socket;
  testGameBusy = true; renderTestGame();
  try {
    const data = await api(`/test-games/${encodeURIComponent(room.room_id)}${suffix}`, body, credential);
    if (activeRoom === room && socket === connection && session === credential) { acceptTestSnapshot(data); feedback(); }
  } catch (error) { if (activeRoom === room) { feedback(error.message); await refreshTestGame(); } }
  finally { testGameBusy = false; testGameSignature = ''; renderTestGame(); }
}
function gameAction(command, payload = {}) {
  if (!testGame?.game) return;
  return testGameRequest('/action', {match_id: testGame.match_id,
    expected_revision: testGame.game.revision, command, payload});
}
function actionButton(label, action, parent = $('game-actions'), enabled = true) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'secondary'; button.textContent = label;
  button.disabled = !enabled || !gameConnected() || testGameBusy;
  button.onclick = action; parent.append(button); return button;
}
function playerLabel(id) { return `Player ${id}${id === testGame?.your_player_id ? ' (you)' : ''}`; }
function tableRow(parent, values) {
  const row = document.createElement('tr');
  for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
  parent.append(row);
}
function cardLabel(card) { return card.slice(0, -1) + suitSymbols[card.slice(-1)]; }
function renderTrickCards(parent, trick) {
  parent.replaceChildren();
  if (!trick) return;
  const count = testGame.capacity;
  for (let offset = 0; offset < count; offset++) {
    const player = (trick.leader - 1 + offset) % count + 1;
    const play = trick.plays.find(p => p.player_id === player);
    const slot = document.createElement('div'); slot.className = 'trick-slot';
    slot.dataset.playerId = String(player);
    const label = document.createElement('small'); label.textContent = playerLabel(player);
    const card = document.createElement('span'); card.className = 'playing-card';
    if (play) {
      card.textContent = cardLabel(play.card);
      card.dataset.card = play.card;
      if (/[HD]$/.test(play.card)) card.classList.add('red-card');
      if (player === trick.winning_player) card.classList.add('winning');
    } else {
      card.textContent = player === trick.current_player ? 'Your turn' : 'Waiting';
      if (player !== testGame.your_player_id && player === trick.current_player) card.textContent = 'Playing…';
      card.classList.add('empty-card');
    }
    slot.append(label, card); parent.append(slot);
  }
}
function renderTestGame() {
  const connected = gameConnected();
  const waiting = testGame?.status === 'waiting';
  $('create-game').disabled = !connected || testGameBusy || !!testGame && !['empty', 'finished'].includes(testGame.status);
  $('game-size').disabled = $('create-game').disabled;
  $('join-game').hidden = !testGame?.can_join;
  $('join-game').disabled = !connected || testGameBusy;
  const signature = JSON.stringify([connected, testGameBusy, testGame?.match_id, testGame?.status,
    testGame?.players, testGame?.game?.revision, testGame?.error]);
  if (signature === testGameSignature) return;
  testGameSignature = signature;
  $('game-roster').replaceChildren();
  for (const player of testGame?.players || []) {
    const badge = document.createElement('span'); badge.className = 'seat';
    badge.textContent = playerLabel(player.player_id) + (player.player_id === 1 ? ' · first dealer' : '');
    badge.title = player.user_id; $('game-roster').append(badge);
  }
  $('game-live').hidden = !testGame?.game;
  if (!connected) { $('game-status').textContent = 'Connect to a room to create or join a game.'; }
  else if (!testGame || testGame.status === 'empty') { $('game-status').textContent = 'No Call Break game yet. Choose four or five players and create one.'; }
  else if (waiting) { $('game-status').textContent = `${testGame.players.length}/${testGame.capacity} seats filled. Starts automatically when full.${testGame.your_player_id ? ' You are seated.' : ' Join to take the next seat.'}`; }
  else { $('game-status').textContent = testGame.error || `Deal ${testGame.deal.deal_number} of 5 · attempt ${testGame.deal.attempt} · dealer ${playerLabel(testGame.deal.dealer)}${testGame.your_player_id ? '' : ' · You are watching'}`; }
  if (!testGame?.game) return;
  const {game, deal, private: mine, rules} = testGame;
  const turn = game.turn, isTurn = turn.player_id === testGame.your_player_id && !!testGame.your_player_id;
  $('game-turn').textContent = game.finished ? `Match complete · Winner${game.winners.length > 1 ? 's' : ''}: ${game.winners.map(playerLabel).join(', ')}` :
    game.phase === 'HAND_REVIEW' ? 'Review your hand before bidding' :
    `${turn.player_id ? playerLabel(turn.player_id) + ' · ' : ''}${game.phase.replaceAll('_', ' ').toLowerCase()}`;
  $('game-rules').textContent = `${rules.plays_per_trick} players · ${rules.tricks_per_deal} tricks/deal · Spades trump · Follow suit and beat when possible · No-spade/weak-hand redeals before bidding`;
  const oldBid = $('test-bid')?.value, oldCut = $('test-cut')?.value;
  $('game-actions').replaceChildren();
  if (isTurn && game.phase === 'AWAITING_SHUFFLE') actionButton('Shuffle deck', () => gameAction('SHUFFLE_DECK'));
  if (isTurn && game.phase === 'AWAITING_CUT') {
    const input = document.createElement('input'); input.type = 'number'; input.id = 'test-cut'; input.min = 1; input.max = 51;
    input.value = oldCut || 26; input.setAttribute('aria-label', 'Cut position'); $('game-actions').append(input);
    actionButton('Cut deck', () => gameAction('CUT_DECK', {position: Number(input.value)}));
    actionButton('Skip cut', () => gameAction('SKIP_CUT'));
  }
  if (isTurn && game.phase === 'AWAITING_DISTRIBUTION') actionButton('Distribute cards', () => gameAction('START_DISTRIBUTION'));
  if (mine?.can_accept_hand) {
    actionButton('Accept hand', () => gameAction('ACCEPT_HAND'));
    if (mine.can_claim_redeal) actionButton('Request redeal', () => gameAction('CLAIM_REDEAL'));
  }
  if (isTurn && game.phase === 'BIDDING') {
    const input = document.createElement('input'); input.type = 'number'; input.id = 'test-bid'; input.min = 1; input.max = rules.bid_max;
    input.value = oldBid || 1; input.setAttribute('aria-label', 'Tricks bid'); $('game-actions').append(input);
    actionButton('Quote tricks', () => gameAction('PLACE_BID', {amount: Number(input.value)}));
  }
  const trick = game.current_trick;
  renderTrickCards($('game-trick'), trick);
  $('game-trick-status').textContent = trick ?
    `Trick ${trick.trick_number} · ${trick.plays_completed}/${trick.plays_required} cards played${trick.winning_player ? ' · currently winning: ' + playerLabel(trick.winning_player) : ''}` :
    game.finished ? 'All tricks completed.' : 'Trick play starts after bidding.';
  const lastTrick = [...deal.tricks].reverse().find(t => t.complete);
  $('game-last-trick-section').hidden = !lastTrick;
  renderTrickCards($('game-last-trick'), lastTrick);
  if (lastTrick) $('game-last-trick-title').textContent = `Last completed trick ${lastTrick.trick_number} · won by ${playerLabel(lastTrick.winner)}`;
  $('game-hand').replaceChildren();
  $('game-hand-label').textContent = mine ? `Your private hand · ${mine.hand.length} cards` : 'Spectator view';
  if (!mine) $('game-hand').textContent = 'Player hands are private.';
  else if (!mine.hand.length) $('game-hand').textContent = ['AWAITING_SHUFFLE', 'SHUFFLING', 'AWAITING_CUT', 'AWAITING_DISTRIBUTION', 'AWAITING_REDEAL'].includes(game.phase) ?
    'Your cards will appear here after the dealer distributes them.' : 'No cards remaining in this deal.';
  else for (const card of [...mine.hand].sort()) {
    const button = actionButton(cardLabel(card), () => gameAction('PLAY_CARD', {card}), $('game-hand'), isTurn && mine.legal_cards.includes(card));
    button.classList.add('playing-card'); if (/[HD]$/.test(card)) button.classList.add('red-card');
    button.dataset.card = card;
    button.title = mine.legal_cards.includes(card) ? `Play ${cardLabel(card)}` : 'Not playable on this turn';
  }
  $('game-table').replaceChildren();
  for (const row of deal.players) tableRow($('game-table'), [playerLabel(row.player_id), row.bid ?? '—', row.tricks_won,
    row.cards_remaining, scoreText(row.score_tenths), scoreText(game.scores_tenths[row.player_id - 1])]);
  $('game-scores').replaceChildren();
  for (const row of testGame.scoreboard) tableRow($('game-scores'), [playerLabel(row.player_id), ...row.deal_scores_tenths.map(scoreText), scoreText(row.total_score_tenths)]);
  $('game-activity').replaceChildren();
  for (const entry of (testGame.log || []).slice(-8).reverse()) {
    const item = document.createElement('li');
    item.textContent = entry.event === 'AutoAction' ? `Auto · ${playerLabel(entry.player_id)} · ${entry.action}` :
      `${entry.event}${entry.payload?.winner_id ? ' · won by ' + playerLabel(entry.payload.winner_id) : ''}`;
    $('game-activity').append(item);
  }
}
$('create-game').onclick = () => testGameRequest('', {player_count: Number($('game-size').value)});
$('join-game').onclick = () => testGameRequest('/join', {match_id: testGame.match_id});
setInterval(refreshTestGame, 1000);
setInterval(() => {
  $('game-countdown').textContent = gameConnected() && testGameDeadline !== null && !testGame?.game?.finished ?
    `Auto action in ${Math.max(0, (testGameDeadline - performance.now()) / 1000).toFixed(1)}s` : '';
}, 100);
renderTestGame();
