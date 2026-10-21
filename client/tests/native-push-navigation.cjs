const {test}=require('node:test'),assert=require('node:assert/strict');
const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
async function fixture(){
 const {pushDestination}=await import('../src/notifications/notificationDestination.ts');
 let receive,cleanup,last,resolveLast;const opened=[],cleared=[];
 const notifications={DEFAULT_ACTION_IDENTIFIER:'default',addNotificationResponseReceivedListener(fn){receive=fn;return {remove(){receive=null;}};},
  getLastNotificationResponseAsync:()=>new Promise(resolve=>{resolveLast=resolve;}),getLastNotificationResponse:()=>last,
  clearLastNotificationResponse(){cleared.push(last);last=null;}};
 const imports={'react':{useRef:value=>({current:value}),useEffect:fn=>{cleanup=fn();}},'expo-notifications':notifications,'./notificationDestination':{pushDestination}};
 const file=path.resolve(__dirname,'../src/notifications/usePushNavigation.native.ts');
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(n=>imports[n],mod,mod.exports);
 const acknowledge=mod.exports.usePushNavigation(target=>opened.push(target));
 const response=(event='event',extra={})=>({actionIdentifier:'default',notification:{request:{identifier:event,content:{data:{type:'bhidne_notification',notification_id:event,user_id:'user-me',kind:'chat',room_id:'',other_user_id:'user-00000000-0000-0000-0000-000000000001',...extra}}}}});
 return {opened,cleared,response,acknowledge,close:()=>cleanup(),resolve:value=>resolveLast(value),tap:value=>{last=value;receive(value);}};
}
test('cold launch queues the recipient-bound destination even without a session',async()=>{
 const f=await fixture();f.resolve(f.response());await Promise.resolve();
 assert.equal(f.opened[0].recipientId,'user-me');assert.equal(f.cleared.length,0);
});
test('live taps win over a delayed cold-launch response and repeated delivery opens once',async()=>{
 const f=await fixture();f.tap(f.response('new'));f.resolve(f.response('old'));await Promise.resolve();f.tap(f.response('new'));
 assert.deepEqual(f.opened.map(v=>v.eventId),['new']);
 f.acknowledge('old');assert.equal(f.cleared.length,0);f.acknowledge('new');assert.equal(f.cleared.length,1);
});
test('unmount, malformed data and non-default actions never navigate',async()=>{
 const f=await fixture();f.tap({...f.response(),actionIdentifier:'dismiss'});f.tap(f.response('bad',{kind:'unknown'}));
 f.close();f.resolve(f.response());await Promise.resolve();assert.deepEqual(f.opened,[]);
});
