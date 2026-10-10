// Isolated browser fixtures; all account and game requests are intercepted.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');

(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const width of [320,390,1280]) for (const kind of ['callbreak','marriage','flush']) {
      const f = await fixture(browser,kind,4,width,false,s => {
        s.status = 'waiting'; s.table.phase = 'OPEN'; s.is_creator = true; s.rule_proposal = null;
        if (s.flush_settings) s.flush_settings.locked = false;
        if (kind === 'callbreak') { s.game = null; s.deal = null; s.private = null; }
        if (kind === 'marriage') s.marriage = null;
      });
      const {page} = f, requests = [];
      page.on('request', req => { if (req.method() === 'POST' && /\/(settings|marriage-settings|flush-settings)$/.test(new URL(req.url()).pathname)) requests.push(req.postDataJSON()); });
      await page.getByRole('button',{name:'Table menu',exact:true}).click();
      await page.getByRole('button',{name:'Basic Game Rules',exact:true}).waitFor();
      await page.getByRole('button',{name:'Game rules and bet config',exact:true}).click();
      const config = page.getByTestId(kind === 'marriage' ? 'marriage-details' : `${kind}-rules-config`);
      await config.waitFor();
      const rules = config.getByRole('tab',{name:'Custom rules',exact:true});
      const bets = config.getByRole('tab',{name:'Bet values',exact:true});
      assert.equal(await rules.getAttribute('aria-selected'),'true');
      if (kind === 'callbreak') await config.getByRole('switch',{name:'No spade, no game',exact:true}).click();
      else if (kind === 'flush') await config.getByRole('textbox',{name:'Minimum betting rounds before side-show',exact:true}).fill('4');
      else await config.getByRole('button',{name:/^Initial Tunnela declaration/}).click();
      const propose = config.getByRole('button',{name:'Propose changes',exact:true});
      const footerBefore = await propose.boundingBox();
      await bets.click();
      const amount = config.getByRole('textbox').first(); await amount.fill('9');
      await rules.click();
      if (kind === 'flush') assert.equal(await config.getByRole('textbox',{name:'Minimum betting rounds before side-show',exact:true}).inputValue(),'4');
      await bets.click(); assert.equal(await amount.inputValue(),'9');
      await config.evaluate(n => { for (const child of n.querySelectorAll('*')) if(getComputedStyle(child).overflowY==='auto') child.scrollTop = child.scrollHeight; });
      assert.deepEqual(await propose.boundingBox(),footerBefore,'proposal footer stays fixed across tabs and scrolling');
      const submitted = page.waitForRequest(req => req.method() === 'POST' && /\/(settings|marriage-settings|flush-settings)$/.test(new URL(req.url()).pathname));
      await propose.click(); await submitted;
      assert.equal(requests.length,1,'one proposal submits both tabs');
      const payload = requests[0];
      if(kind === 'flush') { assert.equal(payload.rules.initial_blind_bet,9); assert.equal(payload.rules.minimum_bet_rounds_before_side_show,4); }
      else if(kind === 'callbreak') { assert.equal(payload.payments[0],9); assert.equal(payload.no_spades_enabled,false); }
      else { assert.equal(payload.scoring.tiplu[0],9); assert.equal(payload.scoring.initial_tunnela_declaration,true); }
      assert.deepEqual(f.errors,[]);
      await page.screenshot({path:`/private/tmp/settings-tabs-${kind}-${width}.png`});
      await f.context.close(); console.log(`PASS ${kind} ${width}: preserved drafts, combined proposal, fixed footer`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
