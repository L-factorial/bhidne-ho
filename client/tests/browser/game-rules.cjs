const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { fixture } = require('./game-stats.cjs');

(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const width of [320,1280]) for (const kind of ['callbreak','marriage','flush']) {
      let state;
      const f = await fixture(browser,kind,4,width,false,snapshot => {
        state = snapshot; snapshot.status = 'waiting'; snapshot.table.phase = 'OPEN';
        snapshot.is_creator = true; snapshot.rule_proposal = null;
        if (snapshot.flush_settings) snapshot.flush_settings.locked = false;
        if (kind === 'callbreak') { snapshot.game = null; snapshot.deal = null; snapshot.private = null; }
        if (kind === 'marriage') snapshot.marriage = null;
      });
      const {page} = f;
      await page.getByRole('button',{name:'Table menu',exact:true}).click();
      await page.getByRole('button',{name:'Basic Game Rules',exact:true}).click();
      const explanation = page.getByTestId('game-rules-explanation'); await explanation.waitFor();
      assert.equal(await explanation.getByRole('textbox').count(),0);
      assert.equal(await explanation.getByRole('switch').count(),0);
      assert.ok((await explanation.innerText()).length > 500);
      await page.screenshot({path:`/private/tmp/bhidne-game-rules-${kind}-${width}.png`});
      await explanation.getByRole('button',{name:'Close game rules',exact:true}).click();
      await page.getByRole('button',{name:'Table menu',exact:true}).click();
      await page.getByRole('button',{name:'Game rules and bet config',exact:true}).click();
      const config = page.getByTestId(kind === 'marriage' ? 'marriage-details' : `${kind}-rules-config`);
      await config.waitFor();
      await config.getByText('Configure before locking. Changes require player approval.',{exact:true}).waitFor();
      await config.getByRole('tab',{name:'Bet values',exact:true}).click();
      const inputs = config.getByRole('textbox'); assert.ok(await inputs.count() > 0);
      assert.equal(await inputs.first().isEnabled(),true);
      await inputs.first().fill('6');
      state.table.phase = 'LOCKED';
      if (state.flush_settings) state.flush_settings.locked = true;
      if (state.game) state.game.revision++;
      await config.getByText('Agreed settings · Read only',{exact:true}).waitFor();
      assert.equal(await config.getByRole('textbox').evaluateAll(nodes => nodes.filter(node => !node.disabled && !node.readOnly).length),0);
      assert.equal(await config.getByRole('switch').evaluateAll(nodes => nodes.filter(node => !node.disabled && node.getAttribute('aria-disabled') !== 'true').length),0);
      assert.equal(await config.getByRole('button',{name:/^Propose /}).count(),0);
      await page.screenshot({path:`/private/tmp/bhidne-game-config-locked-${kind}-${width}.png`});
      assert.ok(f.writes.every(p => !p.endsWith('/action') && !p.endsWith('/settings') && !p.endsWith('/marriage-settings') && !p.endsWith('/flush-settings')));
      assert.deepEqual(f.errors,[]);
      console.log(`PASS ${kind} ${width}: separate explanation/config, editable before lock, read-only after lock`);
      await f.context.close();
    }
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
