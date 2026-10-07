// Provider lifecycle checks with mocked OS permissions and device registration.
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{createRequire}=require('node:module'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const deps=process.env.TEST_REACT_TOOLS?createRequire(path.join(process.env.TEST_REACT_TOOLS,'package.json')):require;
const React=deps('react'),{act,create}=deps('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
function fixture({stored=null,status='granted',os='ios',prompt}={}){
  const values=new Map(stored===null?[]:[['bhidne.push.enabled.v1:api:user',stored]]),calls=[];
  let current={user_id:'user',token:'token'},state;
  const notification={setNotificationHandler(){},AndroidImportance:{HIGH:4},
    async setNotificationChannelAsync(id){calls.push(id);},
    async getPermissionsAsync(){return {status};},
    async requestPermissionsAsync(){calls.push('prompt');return prompt?prompt():{status:'granted'};},
    async getDevicePushTokenAsync(){calls.push('token');return {data:'a'.repeat(64)};},
    addPushTokenListener(){return {remove(){}};},async dismissAllNotificationsAsync(){}};
  class PushSetupError extends Error{}
  const imports={
    'react-native':{Platform:{OS:os},AppState:{currentState:'active',addEventListener(){return {remove(){}};}}},
    'expo-notifications':notification,
    'expo-application':{getIosPushNotificationServiceEnvironmentAsync:async()=> 'production',getIosApplicationReleaseTypeAsync:async()=>1,ApplicationReleaseType:{APP_STORE:1}},
    './nativeRegistration':{PushSetupError,async registerIosDevice(n){const token=await n.token();if(n.active())await n.register(token,'production');}},
    '../multiplayer/api':{apiUrl:'api',async request(route,actor,data,signal,method){calls.push({route,actor,data,method});if(route==='/auth/push/capabilities')return {providers:['apns','fcm']};if(route==='/me/push/preferences')return {actions:true,invitations:true,sound:true};}},
    '../auth/storage':{readAuthValue:k=>values.get(k)??null,writeAuthValue:(k,v)=>values.set(k,v)},
    '../multiplayer/session':{isCurrentSession:(_,actor)=>actor===current},
    '../multiplayer/playerError':{playerError:e=>e.message},'../i18n/core':{default:{resolvedLanguage:'en'}},
    './pushTypes':{defaultPushPreferences:{actions:true,invitations:true,sound:true},notificationTarget:()=>null},
  };
  const file=path.resolve(__dirname,'../src/notifications/PushProvider.native.tsx');
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(n=>n.startsWith('react')&&n!=='react-native'?deps(n):imports[n],mod,mod.exports);
  const {PushProvider,usePush}=mod.exports;
  function Probe(){state=usePush();return null;}
  const element=()=>React.createElement(PushProvider,{session:current,viewedMatch:null},React.createElement(Probe));
  return {values,calls,get state(){return state;},element,setSession(s){current=s;}};
}
const registrations=f=>f.calls.filter(c=>c.route?.startsWith('/me/push/devices/')&&c.data?.token);
test('fresh installation requests OS permission and registers by default; device opt-out survives remount',async()=>{
  const f=fixture({status:'undetermined'});let r;
  await act(async()=>{r=create(f.element());});
  assert.equal(f.state.enabled,true);assert.equal(f.calls.filter(c=>c==='prompt').length,1);assert.equal(registrations(f).length,1);
  await act(async()=>{await f.state.disable();});assert.equal(f.values.get('bhidne.push.enabled.v1:api:user'),'0');
  await act(async()=>r.unmount());await act(async()=>{r=create(f.element());});
  assert.equal(f.state.enabled,false);assert.equal(registrations(f).length,1);
  await act(async()=>{await f.state.enable();});assert.equal(f.state.enabled,true);
  await act(async()=>r.unmount());
});
test('OS denial does not repeatedly prompt or register',async()=>{
  const f=fixture({status:'denied'});let r;await act(async()=>{r=create(f.element());});
  assert.equal(f.state.enabled,false);assert.equal(f.state.error,'PUSH_PERMISSION_REQUIRED');assert.equal(registrations(f).length,0);assert.ok(!f.calls.includes('prompt'));
  await act(async()=>r.unmount());
});
test('Android creates channels before permission and token acquisition',async()=>{
  const f=fixture({status:'undetermined',os:'android'});let r;await act(async()=>{r=create(f.element());});
  assert.ok(f.calls.indexOf('game-actions-silent')<f.calls.indexOf('prompt'));assert.ok(f.calls.indexOf('prompt')<f.calls.indexOf('token'));
  await act(async()=>r.unmount());
});
test('logout during permission prompt prevents registration',async()=>{
  let resolve;const pending=new Promise(r=>{resolve=r;});const f=fixture({status:'undetermined',prompt:()=>pending});let r;
  await act(async()=>{r=create(f.element());});assert.ok(f.calls.includes('prompt'));
  await act(async()=>{f.setSession(null);r.update(f.element());resolve({status:'granted'});});
  assert.equal(registrations(f).length,0);assert.equal(f.state.enabled,false);
  await act(async()=>r.unmount());
});
