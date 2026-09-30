import test from 'node:test';
import assert from 'node:assert/strict';
import { playerPresence } from '../src/multiplayer/playerPresence.ts';

test('only an observed presence list can declare a player offline',()=>{
 assert.equal(playerPresence('alice',['alice'],true),true);
 assert.equal(playerPresence('alice',[],true),false);
 assert.equal(playerPresence('alice',[],false),null);
 assert.equal(playerPresence('alice',['alice'],false),null);
});
