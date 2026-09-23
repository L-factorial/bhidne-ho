// PYTHONPATH=. .venv/bin/python scripts/social_browser_fixtures.py
// Serve a web export. Fixtures isolate UI behavior; no gameplay commands are allowed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['callbreak', 'marriage', 'flush']) {
      const snapshot = JSON.parse(fs.readFileSync(`/tmp/bhidne-social-${kind}.json`));
      const room = { room_id: 'room', name: 'Chat room', members: ['u0', 'u1', 'u2', 'u3'], connected_members: ['u0', 'u1', 'u2', 'u3'] };
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'], hasTouch:true });
      await context.addInitScript(({ room, kind, site }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: kind })), { room, kind, site });
      const history = [], gameplay = [], errors = [], pokeCommands = [];
      let socket;
      await context.route(site + '/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/' || path.startsWith('/_expo/') || path.startsWith('/assets/') || path === '/favicon.ico') return route.continue();
        let data = [];
        if (path === '/rooms') data = [room];
        if (path.startsWith('/test-games/')) { data = snapshot; if (route.request().method() === 'POST') gameplay.push(path); }
        await route.fulfill({ json: data });
      });
      await context.routeWebSocket(site.replace(/^http/, 'ws') + '/**', ws => {
        socket = ws;
        ws.send(JSON.stringify({ type: 'CONNECTED' }));
        ws.onMessage(raw => {
          const command = JSON.parse(raw);
          if (command.type === 'HEARTBEAT') return ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
          const ack = { type: 'TABLE_SOCIAL_ACK', room_id: 'room', match_id: snapshot.match_id, command_id: command.command_id, status: 'accepted' };
          if (command.type === 'TABLE_CHAT_HISTORY') ack.messages = history;
          if (command.type === 'TABLE_CHAT_SEND') {
            const message = { type: 'TABLE_CHAT_MESSAGE', id: command.command_id, room_id: 'room', match_id: snapshot.match_id, sender_id: 'u0', sender_name: 'Host', text: command.payload.text, sent_at: Date.now() };
            history.push(message); ws.send(JSON.stringify(message)); ack.message = message;
          }
          if(command.type === 'TABLE_POKE_SEND') {
            pokeCommands.push(command);
            ws.send(JSON.stringify({type:'TABLE_REACTION',id:command.command_id,room_id:'room',match_id:snapshot.match_id,sender_id:'u0',sender_name:'Player 1',sender_player_id:1,recipient_id:`u${command.payload.recipient_player_id-1}`,recipient_player_id:command.payload.recipient_player_id,reaction:command.payload.reaction,expires_at:Date.now()+4500}));
          }
          ws.send(JSON.stringify(ack));
        });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(site);

      snapshot.game.turn={player_id:2};
      if(snapshot.marriage) snapshot.marriage.public.current_player_id='2';
      snapshot.players.forEach(p=>p.connected=true);
      await page.getByRole('button',{name:/Return to table/}).first().click();
      await page.waitForTimeout(500);
      const button=name=>page.getByRole('button',{name,exact:true});
      for(const method of ['tap','click']) for(const id of [2,3,4]) {
        await button('Poke a player')[method]();
        // Names and badges are part of the player's target, not just the avatar.
        await page.getByText(`Player ${id}`,{exact:true})[method]();
        await page.getByTestId('poke-tools').waitFor();
        await button('Send Clap')[method]();
        await page.getByTestId('poke-tools').waitFor({state:'hidden'});
        await page.getByTestId('table-reaction-flight').first().waitFor();
        assert.equal(pokeCommands.at(-1).payload.recipient_player_id,id);
        assert.equal(pokeCommands.at(-1).payload.reaction,'clap');
      }
      socket.send(JSON.stringify({type:'TABLE_REACTION',id:'incoming-reaction',room_id:'room',match_id:snapshot.match_id,sender_id:'u1',sender_name:'Player 2',sender_player_id:2,recipient_id:'u0',recipient_player_id:1,reaction:'clap',expires_at:Date.now()+4500}));
      await page.getByTestId('table-reaction-catch').getByText('Player 2 sent you clap!',{exact:true}).waitFor();
      assert.equal(pokeCommands.length,6);
      assert.deepEqual(gameplay,[],'poking must never send a gameplay action');
      assert.deepEqual(errors,[]);
      await context.close();console.log('PASS '+kind+': off-turn tap/click on every opponent name, recipient payload, reaction flight and incoming feedback');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
