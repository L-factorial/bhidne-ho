import test from 'node:test';
import assert from 'node:assert/strict';
import {personalLedgerTransfers} from '../src/multiplayer/ledgerPresentation.ts';

test('payment previews appear before settlement exists and keep table context',()=>{
 const preview={payer_id:'alice',payee_id:'bob',amount:25};
 const ledger={personal_settlements:[],tables:[{table_id:'t1',transactions:[],suggested_transfers:[preview]}]};
 assert.deepEqual(personalLedgerTransfers(ledger),[{...preview,table_id:'t1'}]);
 assert.equal(ledger.personal_settlements.length,0);
 assert.equal(preview.table_id,undefined);
});
test('recorded payments are retained once alongside new unsettled results',()=>{
 const paid={transfer_id:'x',batch_id:'b',table_id:'t1',payer_id:'alice',payee_id:'bob',amount:25,status:'RESOLVED'};
 const preview={payer_id:'bob',payee_id:'alice',amount:10};
 const ledger={personal_settlements:[paid],tables:[{table_id:'t1',transactions:[paid],suggested_transfers:[preview]}, {table_id:'t2',transactions:[{...paid,batch_id:'other'}],suggested_transfers:[]}]};
 const rows=personalLedgerTransfers(ledger);
 assert.equal(rows.length,3);
 assert.equal(rows[0].status,'RESOLVED');
 assert.equal(rows[1].table_id,'t2');
 assert.deepEqual(rows[2],{...preview,table_id:'t1'});
 assert.deepEqual(personalLedgerTransfers(),[]);
});

test('combined results retain zero totals and ignore settlement status',async()=>{
 const {ledgerRecordBalances}=await import('../src/multiplayer/ledgerPresentation.ts');
 const rows=[{player_id:'alice',amount:10},{player_id:'bob',amount:-10}];
 const ledger={balances:rows,tables:[{balances:rows}],record_tables:[{record_balances:rows},{record_balances:[{player_id:'alice',amount:-10},{player_id:'bob',amount:10},{player_id:'carol',amount:0}]}]};
 assert.deepEqual(ledgerRecordBalances(ledger),['alice','bob','carol'].map(player_id=>({player_id,amount:0})));
 assert.deepEqual(ledgerRecordBalances(),[]);
});
