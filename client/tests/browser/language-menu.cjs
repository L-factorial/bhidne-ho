const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root=path.resolve(__dirname,'../../dist');
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.join(root,pathname==='/'?'index.html':pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.ttf')?'font/ttf':'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 for(const width of [320,390,1100]) {
 const context=await browser.newContext({viewport:{width,height:844}});const page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Choose language',exact:true}).first().click();
 const menu=page.getByTestId('language-menu');await menu.waitFor();
 const box=await menu.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
 assert.equal(await menu.getByRole('radio',{name:'English',exact:true}).getAttribute('aria-checked'),'true');
 await menu.getByRole('radio').nth(1).click();await menu.waitFor({state:'hidden'});
 await page.reload();
 await page.getByRole('button',{name:'भाषा छान्नुहोस्',exact:true}).first().click();
 assert.equal(await page.getByTestId('language-menu').getByRole('radio').nth(1).getAttribute('aria-checked'),'true');
 await page.getByTestId('language-menu').getByRole('radio',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'Choose language',exact:true}).first().click();
 await page.waitForTimeout(150);await page.keyboard.press('Escape');await page.getByTestId('language-menu').waitFor({state:'hidden'});
 console.log('PASS language selection, checkmark, persistence, Escape, bounds at '+width);await context.close();
 }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
