const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site=process.env.TEST_WEB_URL || 'http://127.0.0.1:8096';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:'dark'});
  await page.goto(site);
  const mode=async value=>page.waitForFunction(value=>document.documentElement.dataset.theme===value,value);
  await mode('dark');
  await page.screenshot({path:'/tmp/theme-lobby-dark.png'});
  await page.emulateMedia({colorScheme:'light'});await mode('light');
  await page.screenshot({path:'/tmp/theme-lobby-light.png'});
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();await mode('dark');
  await page.reload();await mode('dark');
  assert.equal(await page.evaluate(()=>localStorage.getItem('bhidne.appearance')),'dark');
  await page.emulateMedia({colorScheme:'light'});await mode('dark');
  console.log('PASS system follows OS; explicit appearance persists across reload and OS changes');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
