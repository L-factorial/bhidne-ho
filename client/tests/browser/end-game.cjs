// Run with Expo web on localhost:8081. HTTP and WebSocket game data are mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
        let ended = false, calls = 0, started = false, reads = 0;
        const room = { room_id: 'ui-end-check', name: 'End control check', members: ['u0', 'u1', 'u2', 'u3'] };
        await context.addInitScript(room => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: 'callbreak' })), room);
        await context.route('http://localhost:8000/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            let body = [];
            if (path === '/rooms')
                body = [room];
            else if (path.startsWith('/test-games/')) {
                if (route.request().method() === 'GET')
                    reads++;
                if (path.endsWith('/start'))
                    started = true;
                if (path.endsWith('/end')) {
                    ended = true;
                    calls++;
                }
                body = { room_id: room.room_id, match_id: 'm1', capacity: 4, players: room.members.map((user_id, i) => ({ user_id, player_id: i + 1 })), your_player_id: 1, is_creator: true, ready: true, can_join: false, status: ended ? 'ended' : started ? 'playing' : 'waiting', settings: { weak_hand_enabled: true, no_spades_enabled: true, payments: [0, 0, 0, 0] } };
                if (started)
                    Object.assign(body, { game: { revision: 1, phase: 'AWAITING_SHUFFLE', finished: false, winners: [], turn: { player_id: 1 }, current_trick: null, scores_tenths: [0, 0, 0, 0] }, deal: { deal_number: 1, dealer: 1, tricks_completed: 0, tricks_required: 13, tricks: [], players: room.members.map((_, i) => ({ player_id: i + 1, bid: null, tricks_won: 0, cards_remaining: 0 })) }, private: { hand: [], legal_cards: [], can_accept_hand: false, can_claim_redeal: false } });
            }
            await route.fulfill({ json: body });
        });
        await context.routeWebSocket('ws://localhost:8000/**', ws => { ws.send(JSON.stringify({ type: 'CONNECTED' })); ws.onMessage(() => ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }))); });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' && /same key|unique.*key/i.test(m.text()))
            errors.push(m.text()); });
        await page.goto('http://localhost:8081');
        await page.getByRole('button', { name: 'Start game', exact: true }).click();
        await page.getByTestId('card-table').waitFor();
        const initialReads = reads;
        await page.waitForTimeout(5500);
        assert.ok(reads >= initialReads + 3);
        assert.equal(await page.getByRole('button', { name: 'End game', exact: true }).count(), 1);
        assert.deepEqual(errors, []);
        await page.getByRole('button', { name: 'End game', exact: true }).click();
        await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
        assert.equal(calls, 0);
        await page.getByRole('button', { name: 'End game', exact: true }).click();
        await page.getByRole('button', { name: 'End game for everyone', exact: true }).click();
        await page.getByText('Game ended', { exact: true }).waitFor();
        assert.equal(calls, 1);
        await page.getByTestId('live-game-overlay').getByRole('button', { name: 'Start a new game', exact: true }).click();
        await page.getByRole('button', { name: 'Create Call Break game', exact: true }).waitFor();
        assert.deepEqual(errors, []);
        console.log('PASS: starting and repeated refreshes keep one End game control; cancel, end, and new-game flow work.');
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
