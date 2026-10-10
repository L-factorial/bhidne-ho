import test from 'node:test';
import assert from 'node:assert/strict';
import { playerPresence } from '../src/multiplayer/playerPresence.ts';

test('only an observed presence list can declare a player offline',()=>{
 assert.equal(playerPresence('alice',['alice'],true),true);
 assert.equal(playerPresence('alice',[],true),false);
 assert.equal(playerPresence('alice',[],false),null);
 assert.equal(playerPresence('alice',['alice'],false),null);
});

test('the authenticated local socket wins over a delayed self presence list',()=>{
 assert.equal(playerPresence('alice',[],true,{user:'alice',connected:true}),true);
 assert.equal(playerPresence('alice',[],false,{user:'alice',connected:true}),true);
 assert.equal(playerPresence('alice',['alice'],true,{user:'alice',connected:false}),null);
 assert.equal(playerPresence('bob',[],true,{user:'alice',connected:true}),false);
});
