import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';
import * as cues from '../src/notifications/soundCues.ts';
const wait=()=>new Promise(resolve=>setTimeout(resolve,90));
function load(file,extra={}){
 const effects=[],cleanup=[],listeners=new Map();
 const document={hidden:false,visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const appListeners=[];
 const AppState={currentState:'active',addEventListener:(_,fn)=>{appListeners.push(fn);return {remove(){}};}};
 const react={useCallback:fn=>fn,useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const require=name=>name==='react'?react:name==='react-native'?{AppState}:name==='./soundCues'?cues:name==='expo-audio'?extra.audio:name.endsWith('.wav')?name:assert.fail(name);
 vm.runInNewContext(source,{exports,require,document,setTimeout,clearTimeout,console,...extra});
 return {exports,document,listeners,AppState,mount(){effects.forEach(fn=>{const dispose=fn();if(dispose)cleanup.push(dispose);});},background(){AppState.currentState='background';appListeners.forEach(fn=>fn('background'));},cleanup(){cleanup.forEach(fn=>fn());cues.foregroundSounds.cancel();}};
}
test('web requires user interaction and cancels queued/playing sounds when hidden',async()=>{
 let starts=0,stops=0;
 class AudioContext {
  state='running';currentTime=0;destination={};resume(){return Promise.resolve();}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){starts++;},stop(){stops++;}};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
 }
 const h=load('../src/notifications/useForegroundSound.web.ts',{AudioContext});
 const sound=h.exports.useForegroundSound();h.mount();
 try{
  sound.play('chat','locked');await wait();assert.equal(starts,0);
  h.listeners.get('pointerdown')();sound.play('chat','pending');
  h.document.hidden=true;h.document.visibilityState='hidden';h.listeners.get('visibilitychange')();
  await wait();assert.equal(starts,0);
  h.document.hidden=false;h.document.visibilityState='visible';
  sound.play('turn','active');await wait();assert.equal(starts,2);
  h.document.hidden=true;h.listeners.get('visibilitychange')();assert.ok(stops>=4);
  sound.play('won','hidden');await wait();assert.equal(starts,2);
 }finally{h.cleanup();}
});
test('native background stops current audio and rejects new foreground cues',async()=>{
 const calls=[];const player={replace:source=>calls.push(source),play:()=>calls.push('play'),pause:()=>calls.push('pause')};
 const h=load('../src/notifications/useForegroundSound.ts',{audio:{useAudioPlayer:()=>player}});
 const sound=h.exports.useForegroundSound();h.mount();
 try{
  sound.play('chat','native-chat');await wait();assert.ok(calls.includes('play'));
  h.background();assert.ok(calls.includes('pause'));
  const count=calls.length;sound.play('turn','native-background');await wait();assert.equal(calls.length,count);
 }finally{h.cleanup();}
});
test('event baselines suppress initial history, duplicates and foreground catch-up',()=>{
 const h=load('../src/notifications/useFreshSoundEvents.ts');const fresh=h.exports.useFreshSoundEvents('account');h.mount();
 try{
  assert.equal(fresh(['old']).length,0);assert.equal(fresh(['old','new']).join(), 'new');
  assert.equal(fresh(['new']).length,0);h.background();
  assert.equal(fresh(['old','new','background-message']).length,0);
  assert.equal(fresh(['next']).join(),'next');
 }finally{h.cleanup();}
});
