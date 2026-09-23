// Run against a local memory-runtime server and web export.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path,user,body){const r=await fetch(site+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;}
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const stamp=Date.now(), owner=await api('/auth/signup',null,{username:'privacy_'+stamp,password:'Privacy-test-123'}), other=await api('/auth/signup',null,{username:'visitor_'+stamp,password:'Privacy-test-123'});
 async function pageFor(user){const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});await ctx.addInitScript(({site,user})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:user,room:null,game:null})),{site,user});const p=await ctx.newPage();p.setDefaultTimeout(10000);await p.goto(site);return p;}
 const page=await pageFor(owner), button=name=>page.getByRole('button',{name,exact:true});
 await button('Create room').click();
 await button('Private').waitFor();
 await page.getByRole('textbox',{name:'Room name',exact:true}).fill('Privacy browser room');
 await button('Create room').last().click();
 assert.equal((await api('/rooms',owner)).find(r=>r.name==='Privacy browser room').visibility,'private');
 await button('More room actions').click();
 await page.getByRole('textbox',{name:'Find player to invite',exact:true}).fill(other.username);
 await button('Search players').click();
 await button('Invite '+other.username).click();
 await page.getByText('Invitation sent. They become a member when they join.',{exact:true}).waitFor();
 const invitation=(await api('/room-invitations',other))[0];
 assert.ok(invitation);
 await api('/room-invitations/'+invitation.id+'/accept',other,{});
 await api('/rooms/'+invitation.room_id+'/leave',other,{});
 await button('Make room public').click();
 await button('Make room public').getAttribute('aria-selected');
 await page.screenshot({path:'/tmp/privacy-settings.png'});
 await page.getByRole('button',{name:/Close/}).last().click();
 await button('Back to lobby').click();
 const room=(await api('/rooms',owner)).find(r=>r.name==='Privacy browser room');
 await page.getByTestId('room-card-'+room.room_id).waitFor();
 await page.screenshot({path:'/tmp/privacy-room-card.png'});
 await button('Delete Privacy browser room').click();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 const visitor=await pageFor(other);
 await visitor.getByRole('button',{name:'Join Privacy browser room',exact:true}).click();
 await visitor.getByRole('button',{name:'Back to lobby',exact:true}).click();
 await visitor.getByRole('button',{name:'Leave Privacy browser room',exact:true}).click();
 await visitor.getByRole('button',{name:'Leave room',exact:true}).click();
 await page.getByRole('button',{name:'Delete Privacy browser room',exact:true}).click();
 await page.getByRole('button',{name:'Delete room',exact:true}).click();
 assert.ok(!(await api('/rooms',owner)).some(r=>r.room_id===room.room_id));
 console.log('PASS mobile creation private default, owner invitations, privacy edit, public discovery, join, leave, delete');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
