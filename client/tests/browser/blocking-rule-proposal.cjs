const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'), fs=require('node:fs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8098';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,1280]){
  const snapshot=JSON.parse(fs.readFileSync('/tmp/bhidne-social-marriage.json'));
  snapshot.rule_proposal=null;
  const room={room_id:'room',name:'Vote test',members:['u0','u1','u2','u3']};
  const ctx=await browser.newContext({viewport:{width,height:900}});
  await ctx.addInitScript(({site,room})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room,game:'marriage'})),{site,room});
  let rejectRequest=true;const votes=[];
  await ctx.route(site+'/**',async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path==='/'||path.startsWith('/_expo/')||path.startsWith('/assets/')||path==='/favicon.ico')return r.continue();
   if(path.endsWith('/rule-vote')){
    const body=r.request().postDataJSON();votes.push(body);
    if(rejectRequest)return r.fulfill({status:409,json:{detail:'Retry your vote.'}});
    if(body.accept){snapshot.rule_proposal.accepted.push('u0');snapshot.rule_proposal.can_vote=false;}
    else snapshot.rule_proposal.status='REJECTED';
   }
   await r.fulfill({json:path.startsWith('/test-games/')?snapshot:path==='/rooms'?[room]:[]});
  });
  await ctx.routeWebSocket(site.replace('http','ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  const page=await ctx.newPage();page.setDefaultTimeout(10000);
  await page.goto(site);await page.getByRole('button',{name:/Return to table/}).first().click();
  const proposal=()=>({id:Math.random().toString(),status:'PENDING',proposer_name:'Friend',voters:['u0','u1','u2'],accepted:['u1'],can_vote:true,previous:{seen_payment:3},proposed:{seen_payment:7}});
  snapshot.rule_proposal=proposal();
  const dialog=page.getByTestId('rule-proposal-dialog');await dialog.waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Close rule review'}).count(),0);
  await page.keyboard.press('Escape');assert.ok(await dialog.isVisible());
  await dialog.getByRole('button',{name:'Accept rules'}).click();
  await dialog.getByText('Retry your vote.',{exact:true}).waitFor();rejectRequest=false;
  await dialog.getByRole('button',{name:'Accept rules'}).click();
  await dialog.getByText('Your acceptance is recorded. Waiting for every seated player to accept.',{exact:true}).waitFor();
  assert.equal(snapshot.rule_proposal.status,'PENDING');
  assert.equal(await dialog.getByRole('button',{name:'Accept rules'}).count(),0);
  snapshot.rule_proposal.accepted.push('u2');snapshot.rule_proposal.status='ACCEPTED';
  await dialog.waitFor({state:'hidden'});
  snapshot.rule_proposal=proposal();await dialog.waitFor();
  await dialog.getByRole('button',{name:'Reject rules'}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(votes.at(-1).accept,false);
  assert.equal(snapshot.rule_proposal.status,'REJECTED');
  await ctx.close();console.log(`PASS blocking rule vote, retry, waiting, unanimous resolution and rejection at ${width}px`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
