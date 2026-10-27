import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {CommandJournal} from '../src/multiplayer/CommandJournal.ts';
import {DistributedSession} from '../src/multiplayer/DistributedSession.ts';
import {creationProgress} from '../src/multiplayer/creationProgress.ts';
const parse=f=>ts.createSourceFile(f,fs.readFileSync(new URL('../src/'+f,import.meta.url),'utf8'),99,true);
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const hookNode=parse('components/CreationCards.tsx').statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useCreationProgress');
const cls=parse('multiplayer/OriginalDistributedRuntime.ts').statements.find(ts.isClassDeclaration);
const getter=cls.members.find(n=>ts.isGetAccessor(n)&&n.name.getText()==='creationProgressSnapshot');
const Runtime=vm.runInNewContext(compile('class Runtime {'+getter.getText()+'}\nRuntime;'));
function fixture(initial='active'){
 const data=new Map();let reads=0,locked=false,state,dispose,id=0;
 const journal=new CommandJournal({read:k=>{reads++;if(locked)throw Error('Keychain locked');return data.get(k)??null},write:(k,v)=>data.set(k,v)},'alice','device');
 journal.saveCreationFlow({id:'flow',defaultName:'Family',room:null,payload:{game_type:'flush'}});
 const session=new DistributedSession('device',{commands:{}},{install(){},remove(){},error(){}},{},journal);
 session.command('ui-table-control');
 const runtime=new Runtime();Object.assign(runtime,{closed:false,journal,root:{session},creationFeedback:new Map()});
 const timers=new Map(),listeners=new Set();
 const AppState={currentState:initial,addEventListener:(_,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)}}};
 const hook=vm.runInNewContext('(function(){'+compile(hookNode.getText().replace(/^export /,''))+';return useCreationProgress;})()',{
 AppState,creationProgress,useState:x=>[x,v=>{state=v}],useEffect:fn=>{dispose=fn()},setInterval:fn=>{timers.set(++id,fn);return id},clearInterval:n=>timers.delete(n)});
 const before=reads;hook(runtime);
 return {journal,session,runtime,timers,listeners,get reads(){return reads-before},get state(){return state},lock(){locked=true},unlock(){locked=false},tick(){for(const fn of [...timers.values()])fn()},transition(s){AppState.currentState=s;for(const fn of listeners)fn(s)},cleanup(){dispose();session.close()}};
}
test('display snapshots never read Keychain or bind command slots and are detached',()=>{
 const f=fixture();try{assert.equal(f.reads,0);assert.equal(f.session.commandSnapshot('original-room-actions'),null);assert.equal(f.state.cards[0].id,'flow');f.runtime.creationProgressSnapshot.flow.payload.game_type='marriage';assert.equal(f.runtime.creationProgressSnapshot.flow.payload.game_type,'flush');f.tick();assert.equal(f.reads,0)}finally{f.cleanup()}
});
test('inactive/locked stops polling, queued callbacks do nothing, unlock refreshes',()=>{
 const f=fixture();try{const queued=[...f.timers.values()][0];f.transition('inactive');f.lock();f.transition('background');assert.equal(f.timers.size,0);assert.doesNotThrow(queued);assert.equal(f.reads,0);f.unlock();f.transition('active');assert.equal(f.timers.size,1);assert.equal(f.state.cards[0].id,'flow');f.lock();assert.doesNotThrow(()=>f.tick());assert.equal(f.reads,0)}finally{f.cleanup()}
});
test('background mount waits for active',()=>{
 const f=fixture('background');try{assert.equal(f.timers.size,0);assert.equal(f.state,undefined);f.lock();f.tick();assert.equal(f.reads,0);f.unlock();f.transition('active');assert.equal(f.state.cards[0].id,'flow')}finally{f.cleanup()}
});
test('failed journal can be displayed without unblocking commands',()=>{
 const f=fixture();try{f.lock();assert.throws(()=>f.journal.check(),/Keychain locked/);f.unlock();assert.doesNotThrow(()=>f.tick());assert.equal(f.state.cards[0].id,'flow');assert.throws(()=>f.session.command('ui-table-control'),/Journal unavailable/)}finally{f.cleanup()}
});
test('closed session and runtime do not throw or retain old display state',()=>{
 const f=fixture();try{f.session.close();assert.doesNotThrow(()=>f.tick());assert.equal(f.session.commandSnapshot('ui-table-control'),null);f.runtime.closed=true;f.tick();assert.equal(f.state.cards.length,0);assert.equal(f.state.feedback.length,0)}finally{f.cleanup()}
});
test('cleanup removes timers/listeners and makes queued callbacks inert',()=>{
 const f=fixture(),queued=[...f.timers.values()][0],old=f.state;f.cleanup();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);assert.doesNotThrow(queued);assert.equal(f.state,old);
});
