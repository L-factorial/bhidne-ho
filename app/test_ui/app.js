'use strict';
const $ = id => document.getElementById(id);
let session = null, socket = null, activeRoom = null, rooms = [], signingUp = false;
let refreshing = false;
const events = [];

function feedback(message = '') {
  $('feedback').textContent = message;
  $('feedback').hidden = !message;
}
function log(direction, data) {
  events.push(`${new Date().toLocaleTimeString()} ${direction}\n${JSON.stringify(data, null, 2)}`);
  if (events.length > 100) events.shift();
  $('event-log').textContent = events.join('\n\n');
  $('event-log').scrollTop = $('event-log').scrollHeight;
}
async function api(path, body, credential = session) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'Content-Type': 'application/json', ...(credential ? {Authorization: `Bearer ${credential.token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && credential && credential === session) {
      signOut();
      throw new Error('Session expired. Sign in again; a server restart clears test accounts.');
    }
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Check the form fields and try again.');
  }
  return data;
}
function connectionStatus(text, connected = false) {
  $('connection-status').textContent = text;
  $('connection-status').classList.toggle('connected', connected);
  $('message').disabled = $('send').disabled = !connected;
  $('leave').disabled = !socket;
  if (typeof renderTestGame === 'function') renderTestGame();
}
function renderSession() {
  $('auth-panel').hidden = !!session;
  $('signed-in').hidden = !session;
  $('identity-status').textContent = session ? 'Signed in' : 'Signed out';
  $('account-name').textContent = session?.username || 'Guest player';
  $('user-id').textContent = session?.user_id || '';
  $('room-controls').disabled = !session;
  $('refresh').disabled = !session;
}
function saveSession(value) {
  session = value;
  try { sessionStorage.setItem('bhidne-test-session', JSON.stringify(value)); } catch { /* Memory session still works. */ }
  renderSession();
}
function leave() {
  const previous = socket;
  socket = null;
  if (previous) previous.close();
  activeRoom = null;
  if (typeof resetTestGame === 'function') resetTestGame();
  connectionStatus('Disconnected');
  $('active-room').textContent = 'No room selected';
  $('active-room-id').textContent = 'Create a room or join one to begin.';
  renderRooms();
}
function signOut() {
  leave();
  saveSession(null);
  rooms = [];
  $('password').value = '';
  $('messages').replaceChildren();
  events.length = 0;
  $('event-log').textContent = 'No events yet.';
  renderRooms();
}
function renderRooms() {
  $('room-list').replaceChildren();
  if (!rooms.length || !session) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = session ? 'No rooms yet. Create the first test table.' : 'Sign in to see available rooms.';
    $('room-list').append(empty);
  } else for (const room of rooms) {
    const button = document.createElement('button');
    button.className = `room-item${activeRoom?.room_id === room.room_id ? ' active' : ''}`;
    const description = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = room.name;
    const id = document.createElement('code'); id.textContent = room.room_id;
    description.append(name, id);
    const count = document.createElement('small'); count.textContent = `${room.members.length} online`;
    button.append(description, count);
    button.onclick = () => join(room);
    $('room-list').append(button);
  }
  const current = activeRoom && rooms.find(r => r.room_id === activeRoom.room_id);
  const members = current?.members || [];
  $('member-count').textContent = `${members.length} connected`;
  $('members').textContent = members.map(id => id === session?.user_id ? 'You' : id.slice(0, 13)).join(' · ') || '—';
  $('members').title = members.join('\n');
}
async function refreshRooms() {
  if (!session || refreshing) return;
  const credential = session;
  refreshing = true;
  try {
    const result = await api('/rooms', undefined, credential);
    if (session === credential) { rooms = result; renderRooms(); }
  } catch (error) { feedback(error.message); }
  finally { refreshing = false; }
}
function addMessage(text, sender, own = false) {
  $('messages').querySelector('.chat-empty')?.remove();
  const bubble = document.createElement('div'); bubble.className = `bubble${own ? ' own' : ''}`;
  const label = document.createElement('small');
  label.textContent = `${own ? 'You · sent (not acknowledged)' : sender} · ${new Date().toLocaleTimeString()}`;
  const body = document.createElement('p'); body.textContent = text;
  bubble.append(label, body); $('messages').append(bubble);
  while ($('messages').children.length > 200) $('messages').firstChild.remove();
  $('messages').scrollTop = $('messages').scrollHeight;
}
function join(room) {
  if (!session) return;
  feedback();
  leave();
  activeRoom = room;
  $('active-room').textContent = room.name;
  $('active-room-id').textContent = room.room_id;
  $('messages').replaceChildren();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(`${scheme}//${location.host}/ws/rooms/${encodeURIComponent(room.room_id)}?token=${encodeURIComponent(session.token)}`);
  socket = current;
  connectionStatus('Connecting…');
  renderRooms();
  current.onmessage = event => {
    if (socket !== current) return;
    let data;
    try { data = JSON.parse(event.data); } catch { feedback('Received an invalid JSON event.'); return; }
    log('← RECEIVED', data);
    if (data.type === 'CONNECTED') {
      connectionStatus('Connected', true);
      refreshRooms();
      if (typeof refreshTestGame === 'function') refreshTestGame();
      $('message').focus();
    } else if (data.type === 'TEST_GAME_STATE') {
      if (typeof acceptTestSnapshot === 'function') acceptTestSnapshot(data.payload);
    } else if (data.type === 'TEST_GAME_EVENT') {
      // Already visible in the inspector; projected state updates the game panel.
    } else if (data.type === 'MESSAGE') {
      addMessage(typeof data.payload?.text === 'string' ? data.payload.text : JSON.stringify(data.payload), data.sender_id);
    } else if (data.type === 'GAME_EVENT' && !data.match_id) {
      addMessage(JSON.stringify(data.payload), `Server · ${data.event}`);
    } else if (data.type === 'ERROR') feedback(data.detail || data.code);
  };
  current.onclose = event => {
    if (socket !== current) return;
    socket = null;
    connectionStatus('Disconnected');
    log('• CLOSED', {code: event.code, room_id: room.room_id});
    feedback('Connection closed. Select the room again to reconnect.');
    refreshRooms();
  };
  current.onerror = () => {
    if (socket === current) feedback('Could not connect. Check the server and your session, then rejoin.');
  };
}
function setMode(value) {
  signingUp = value;
  $('signup-mode').classList.toggle('selected', value);
  $('signin-mode').classList.toggle('selected', !value);
  $('signup-mode').setAttribute('aria-pressed', String(value));
  $('signin-mode').setAttribute('aria-pressed', String(!value));
  $('auth-submit').textContent = value ? 'Create account' : 'Sign in';
  $('password').autocomplete = value ? 'new-password' : 'current-password';
  feedback();
}
$('signup-mode').onclick = () => setMode(true);
$('signin-mode').onclick = () => setMode(false);
async function authenticate(path, body) {
  feedback();
  $('auth-submit').disabled = $('guest').disabled = true;
  try {
    const value = await api(path, body, null);
    saveSession(value);
    $('password').value = '';
    await refreshRooms();
  } catch (error) { feedback(error.message); }
  finally { $('auth-submit').disabled = $('guest').disabled = false; }
}
$('auth-form').onsubmit = event => {
  event.preventDefault();
  authenticate(signingUp ? '/auth/signup' : '/auth/signin', {username: $('username').value, password: $('password').value});
};
$('guest').onclick = () => authenticate('/auth/guest', {});
$('signout').onclick = () => { signOut(); feedback(); };
$('refresh').onclick = refreshRooms;
$('leave').onclick = () => { leave(); refreshRooms(); feedback(); };
$('create-form').onsubmit = async event => {
  event.preventDefault(); feedback();
  const name = $('room-name').value.trim();
  if (!name) { feedback('Enter a room name.'); return; }
  const button = event.submitter;
  const credential = session;
  button.disabled = true;
  try {
    const room = await api('/rooms', {name});
    if (session !== credential) return;
    $('room-name').value = '';
    join(room);
    await refreshRooms();
  } catch (error) { feedback(error.message); }
  finally { button.disabled = false; }
};
$('join-form').onsubmit = event => {
  event.preventDefault();
  const room_id = $('room-id').value.trim();
  join(rooms.find(r => r.room_id === room_id) || {room_id, name: room_id});
};
$('message-form').onsubmit = event => {
  event.preventDefault();
  if (!socket || socket.readyState !== WebSocket.OPEN || $('send').disabled) return;
  const text = $('message').value.trim();
  if (!text) return;
  let data;
  try {
    data = text === 'PING' || text.startsWith('PING ')
      ? {type: 'GAME_COMMAND', command: 'PING', payload: {message: text.slice(4).trimStart()}}
      : text.startsWith('{') ? JSON.parse(text) : {type: 'MESSAGE', payload: {text}};
  } catch { feedback('Invalid JSON. Check the envelope and try again.'); return; }
  try {
    socket.send(JSON.stringify(data));
    log('→ SENT', data);
    if (data.type === 'MESSAGE') addMessage(text, session.user_id, true);
    $('message').value = '';
    feedback();
  } catch { feedback('Message could not be sent. Rejoin the room and try again.'); }
};
$('clear-log').onclick = () => { events.length = 0; $('event-log').textContent = 'No events yet.'; };
async function restore() {
  try {
    const stored = JSON.parse(sessionStorage.getItem('bhidne-test-session'));
    if (stored?.token && stored?.user_id) {
      saveSession(stored);
      await api('/auth/me');
      await refreshRooms();
    }
  } catch (error) { signOut(); feedback(error.message); }
}
renderSession();
restore();
setInterval(refreshRooms, 2000);
