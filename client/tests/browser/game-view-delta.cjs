// Isolated browser codec/recovery smoke test; no application services required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const samples = JSON.parse(fs.readFileSync(process.env.VIEW_DELTA_SAMPLES ||
  path.join(__dirname, '../fixtures/game-view-delta.json'), 'utf8'));
const cases = Array.isArray(samples) ? samples : [samples];
const source = name => ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../../src/multiplayer', name + '.ts'), 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    for (const name of ['GameViewDelta','ViewDigest']) await page.addScriptTag({content:
      `(function(){const exports={};${source(name)};window.${name}=exports;})();`});
    const evidence = await page.evaluate(async cases => {
      const {applyViewDelta,canonicalView}=window.GameViewDelta;
      const {viewDigest}=window.ViewDigest;
      const results=[];
      for (const sample of cases) {
        const {before,after,delta}=sample;
        const saved=JSON.stringify(before),start=performance.now();
        const result=await applyViewDelta(before,delta,delta.game_id,delta.base_revision,viewDigest);
        if(canonicalView(result.value)!==canonicalView(after)||JSON.stringify(before)!==saved)
          throw Error('Incorrect result or mutated base');
        let rejected=0;
        for (const failure of [{...delta,base_revision:delta.base_revision-1},
          {...delta,checksum:'0'.repeat(64)}, {...delta,operations:delta.operations.slice(1)}]) {
          try {await applyViewDelta(before,failure,delta.game_id,delta.base_revision,viewDigest);}
          catch {rejected++;}
        }
        if(rejected!==3||JSON.stringify(before)!==saved)throw Error('Recovery validation failed');
        results.push({game:sample.kind||'shared-fixture',snapshotBytes:JSON.stringify(after).length,
          deltaBytes:JSON.stringify(delta).length,applyAndRecoveryMs:performance.now()-start});
      }
      return results;
    },cases);
    assert.equal(evidence.length,cases.length);
    console.log(JSON.stringify({browser:'Chromium',cases:evidence},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
