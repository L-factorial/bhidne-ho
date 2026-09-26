import { validateCommandCheckpoint } from './DurableCommandClient.ts';
import type { CommandCheckpoint, CommandPersistence } from './DurableCommandClient.ts';

// Synchronous durable atomic replacement, NOT a write-behind cache. An async-only
// platform needs an awaited adapter/lifecycle before using this synchronous API.
export type JournalStorage = { read(key: string): string | null; write(key: string, value: string): void };
type Document = { version: 1; account: string; device: string; slots: [string, CommandCheckpoint][] };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const validName = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 128;

export class CommandJournal {
  private store: JournalStorage;
  private key: string;
  private raw: string | null;
  private document: Document;
  private closed = false;
  private failed = false;
  private bound = new Set<string>();

  constructor(store: JournalStorage, account: string, device: string) {
    if (!validName(account) || !validName(device)) throw new Error('Invalid journal identity.');
    this.store = store;
    this.key = `distributed-commands:${JSON.stringify([account, device])}`;
    this.raw = store.read(this.key);
    const value: Document = this.raw === null ? { version: 1, account, device, slots: [] } : this.decode(this.raw);
    if (value.version !== 1 || value.account !== account || value.device !== device || !Array.isArray(value.slots)
        || value.slots.length > 32) throw new Error('Invalid journal scope or version.');
    const seen = new Set<string>();
    for (const row of value.slots) {
      if (!Array.isArray(row) || row.length !== 2 || !validName(row[0]) || seen.has(row[0])) throw new Error('Invalid journal slot.');
      seen.add(row[0]); row[1] = validateCommandCheckpoint(row[1]);
    }
    this.document = value;
  }
  private decode(raw: string): Document {
    if (raw.length * 2 > 1048576) throw new Error('Journal exceeds storage bound.');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new Error('Invalid journal document.');
    return value;
  }
  check() {
    if (this.closed || this.failed) throw new Error('Journal unavailable; reopen after resolving storage failure.');
    try {
      // Detect stale sequential writers/storage loss. This is NOT cross-tab CAS;
      // the platform must grant one active owner of an account/device namespace.
      if (this.store.read(this.key) !== this.raw) throw new Error('Journal changed outside this session.');
    } catch (e) { this.failed = true; throw e; }
  }
  assertDevice(device: string) {
    this.check();
    if (this.document.device !== device) throw new Error('Journal belongs to another device.');
  }
  get slots(): string[] { this.check(); return this.document.slots.map(([slot]) => slot); }
  private commit(next: Document) {
    this.check();
    try {
      const raw = JSON.stringify(next);
      if (raw.length * 2 > 1048576) throw new Error('Journal exceeds storage bound.');
      this.store.write(this.key, raw);
      if (this.store.read(this.key) !== raw) throw new Error('Journal write did not persist.');
      this.document = next; this.raw = raw;
    } catch (e) { this.failed = true; throw e; }
  }
  bind(slot: string): CommandPersistence {
    this.check();
    if (!validName(slot) || this.bound.has(slot) || this.bound.size >= 32) throw new Error('Invalid or already bound journal slot.');
    this.bound.add(slot);
    const check = () => { this.check(); if (!this.bound.has(slot)) throw new Error('Journal slot released.'); };
    return {
      check,
      load: () => { check(); return clone(this.document.slots.find(([name]) => name === slot)?.[1] ?? null); },
      save: value => {
        check(); const saved = validateCommandCheckpoint(value), next = clone(this.document);
        const old = next.slots.find(([name]) => name === slot);
        if (old) {
          const previous = old[1];
          if (!previous.receipt || previous.receipt.status === 'pending') {
            if (JSON.stringify(previous.request) !== JSON.stringify(saved.request)) throw new Error('Cannot replace an unresolved command.');
          }
          old[1] = saved;
        } else {
          if (next.slots.length >= 32) throw new Error('Journal slot bound exceeded.');
          next.slots.push([slot, saved]);
        }
        this.commit(next);
      },
    };
  }
  release(slot: string) {
    this.check();
    const value = this.document.slots.find(([name]) => name === slot)?.[1];
    if (value && (!value.receipt || value.receipt.status === 'pending')) throw new Error('Cannot discard an unresolved command.');
    const next = clone(this.document); next.slots = next.slots.filter(([name]) => name !== slot);
    this.commit(next); this.bound.delete(slot);
  }
  // Logout closes access but retains uncertain work for the same account/device.
  close() { this.closed = true; this.bound.clear(); }
}
