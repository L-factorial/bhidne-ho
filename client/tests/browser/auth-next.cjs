const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:844}});const page=await context.newPage(),errors=[],writes=[];page.setDefaultTimeout(10000);
   page.on('pageerror',e=>errors.push(e.message));
   await page.route(site+'/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;if(path==='/'||path.startsWith('/assets/')||path.startsWith('/_expo/')||path==='/favicon.ico')return route.continue();if(request.method()!=='GET')writes.push(path);await route.fulfill({json:path==='/auth/safety/capabilities'?{blocking:false,reporting:true}:[]});});
   await page.goto(site);await page.getByRole('button',{name:'Sign in or sign up',exact:true}).click();await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();
   const field=name=>page.getByRole('textbox',{name,exact:true});const password=page.getByLabel('Password',{exact:true});
   await field('Username or email').fill('alice');await page.getByRole('button',{name:'Next field',exact:true}).click();assert.ok(await password.evaluate(node=>node===document.activeElement));
   await page.getByRole('button',{name:'Sign up',exact:true}).click();await page.getByRole('button',{name:'Sign up with username or email',exact:true}).click();
   await field('Username').fill('alice');await page.getByRole('button',{name:'Next field',exact:true}).nth(0).click();assert.ok(await field('Email').evaluate(node=>node===document.activeElement));
   await field('Email').fill('alice@example.test');await field('Email').press('Enter');assert.ok(await password.evaluate(node=>node===document.activeElement));
   await password.fill('Example-password-123');await page.getByRole('button',{name:'Next field',exact:true}).nth(2).click();const confirm=page.getByLabel('Confirm password',{exact:true});assert.ok(await confirm.evaluate(node=>node===document.activeElement));
   // Simulate a browser keyboard viewport and ensure the focused next field is revealed.
   await page.evaluate(()=>{const viewport=window.visualViewport;Object.defineProperty(viewport,'height',{configurable:true,get:()=>380});viewport.dispatchEvent(new Event('resize'));});
   await page.waitForTimeout(200);const box=await confirm.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=380+1,JSON.stringify(box));
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await context.close();console.log(`PASS auth ${width}: arrow/Next focus and keyboard clearance.`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
