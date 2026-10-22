import type {Balance, Ledger, Transfer} from '../components/RoomLedger';

// Suggested transfers cover only games not already claimed by a settlement.
// Keep recorded transfers authoritative and include previews without creating a batch.
export function personalLedgerTransfers(ledger?: Ledger): Transfer[] {
  if (!ledger) return [];
  const recorded = [...ledger.personal_settlements];
  for (const table of ledger.tables) {
    for (const row of table.transactions) {
      if (!recorded.some(existing => row.transfer_id && existing.transfer_id === row.transfer_id && existing.batch_id === row.batch_id)) {
        recorded.push({...row, table_id: table.table_id});
      }
    }
  }
  return [...recorded, ...ledger.tables.flatMap(table => table.suggested_transfers.map(row => ({...row, table_id: table.table_id})))];
}

// Historical results include zero balances and never change when payments settle.
export function ledgerRecordBalances(ledger?: Ledger): Balance[] {
  if (!ledger) return [];
  const tables = ledger.record_tables || ledger.tables;
  if (!tables.length) return ledger.balances;
  const totals = new Map<string, number>();
  for (const table of tables) for (const row of table.record_balances || table.balances) {
    totals.set(row.player_id, (totals.get(row.player_id) || 0) + row.amount);
  }
  return [...totals].map(([player_id,amount]) => ({player_id,amount})).sort((a,b) => b.amount-a.amount || a.player_id.localeCompare(b.player_id));
}
