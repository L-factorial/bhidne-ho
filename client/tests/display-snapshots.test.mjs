import test from 'node:test';
import assert from 'node:assert/strict';
import {displaySnapshot,clearDisplaySnapshots} from '../src/multiplayer/displaySnapshots.ts';

test('new ledger reader retains last display but rejects late responses from its predecessor',()=>{
 clearDisplaySnapshots();const scope=displaySnapshot('account:room');const old=scope.beginRead();old.write({balance:10});
 const next=displaySnapshot('account:room');assert.deepEqual(next.read(),{balance:10});
 next.beginRead().write({balance:20});old.write({balance:5});assert.deepEqual(next.read(),{balance:20});
});
test('logout invalidates both private snapshots and in-flight writers',()=>{
 clearDisplaySnapshots();const scope=displaySnapshot('account:room');const old=scope.beginRead();old.write({balance:10});clearDisplaySnapshots();old.write({balance:99});
 assert.equal(old.current(),false);assert.equal(displaySnapshot('account:room').read(),undefined);
});
test('snapshot expiry still permits a successful fresh read to replace it',()=>{
 clearDisplaySnapshots();const real=Date.now;let now=0;Date.now=()=>now;
 try{const cache=displaySnapshot('room');cache.beginRead().write(10);now=300001;assert.equal(cache.read(),undefined);cache.beginRead().write(20);assert.equal(cache.read(),20);}finally{Date.now=real;}
});
test('snapshots are bounded and isolated by account and room',()=>{
 clearDisplaySnapshots();const one=displaySnapshot('one:room');one.beginRead().write(1);
 assert.equal(displaySnapshot('two:room').read(),undefined);
 for(let i=0;i<33;i++)displaySnapshot('room'+i).beginRead().write(i);
 assert.equal(one.current(),false);assert.equal(displaySnapshot('one:room').read(),undefined);
});
