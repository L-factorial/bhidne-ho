const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const out='/private/tmp/bhidne-summary-pickers';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
for(const kind of ['marriage','flush','callbreak']){
 const f=await fixture(browser,kind,4,390),p=f.page;
 const theme=p.getByTestId('summary-theme-picker'),language=p.getByTestId('summary-language-picker');
 assert.ok(!(await language.innerText()).includes('Language'));
 const toolbar=await p.getByTestId('game-summary-toolbar').boundingBox();assert.ok(toolbar.height<=56);
 const a=await p.getByTestId('game-stats-toggle').boundingBox(),b=await theme.boundingBox();assert.ok(b.y>=a.y+a.height-1);
 const c=await p.getByTestId('table-summary-toggle').boundingBox(),d=await language.boundingBox();assert.ok(d.y>=c.y+c.height-1);
 await p.screenshot({path:`${out}/${kind}.png`});
 await theme.click();await p.getByTestId('app-theme-sheet').waitFor();await p.screenshot({path:`${out}/${kind}-theme.png`});
 await p.getByRole('button',{name:'Close themes',exact:true}).click();
 await language.click();await p.getByTestId('language-menu').waitFor();await p.screenshot({path:`${out}/${kind}-language.png`});
 await p.getByRole('radio',{name:'English',exact:true}).click();await p.getByTestId('language-menu').waitFor({state:'hidden'});
 assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log('PASS',kind);
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
