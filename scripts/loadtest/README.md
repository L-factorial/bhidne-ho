# Distributed gameplay load test

Run from the repository root with Node 22.18 or newer. No additional npm packages
are needed. The runner uses the same distributed command journals, HTTP adapters
and WebSocket subscriptions as the original UI. It does not automate a browser.

## Accounts and execution

Generate a dedicated pool of 20,000 users. This only writes credentials locally:

```sh
node --experimental-strip-types scripts/loadtest/run.mts --mode generate
```

The default file is `.loadtest/accounts.jsonl`, one JSON object per line:

```json
{"username":"load_example_00001","password":"a-dedicated-test-password"}
```

Generation refuses to overwrite an existing file. The directory is Git-ignored;
new credential files have mode 0600. Use only dedicated `load_` accounts. An
existing file can be supplied with `--accounts PATH`. Do not share account files
between simultaneous runners: each account must have one active scenario owner.

At scenario login the driver reads the current community rules and accepts them
for these dedicated synthetic accounts before sending social commands. It checks
that acceptance was saved and fails the scenario if this setup fails. Normal
account signup and server posting enforcement are unchanged.

Choose the explicit API target, then provision accounts before starting the clock:

```sh
LOAD_TARGET=http://127.0.0.1:8000
node --experimental-strip-types scripts/loadtest/run.mts \
  --mode provision --url "$LOAD_TARGET"
node --experimental-strip-types scripts/loadtest/run.mts \
  --url "$LOAD_TARGET" --seconds 3600 --users 1000 --ramp 300
```

Provisioning uses eight workers and signs in first so it can resume after an
interruption. An existing account with a different password is an error. It uses
normal signup/signin endpoints; it does not bypass authentication or write SQL.

Signup requires email. JSONL entries may supply `email`; otherwise enrollment uses
`<username>@loadtest.example.test`, a synthetic test address. This does not verify
a mailbox or test email delivery/recovery. Existing account sign-in needs no email.
Running sends real writes and creates real ledger records on the selected target.
The default URL is deliberately unspecified. No live target has been load tested
by adding these scripts.

The **20,000 accounts form the rotating pool**. `--users 1000` allows up to 1,000
simultaneously active accounts, in groups of four (250 tables), ramped over five
minutes. Use `--users 20000` for 20,000 concurrent accounts; that is a different
load profile. Actual concurrency includes login/setup/cleanup, so it is not a
promise of that many simultaneous open sockets or games. The report records the
unique accounts actually used; it does not assume every account was reached.
Users are shuffled before the first pass, exclusively leased to a group, then
returned to the queue after successful cleanup. Failed groups are retired from
this run to avoid conflicting with unresolved commands.

One hour includes ramp-up. No new scenario starts after the hour; games already
started have up to `--drain 180` extra seconds to finish and validate. SIGINT/SIGTERM
also stop admission and allow that drain. Interrupted games count as failures,
not completed games. `--max-games N` limits total attempted scenarios for smoke
tests. `--seed 42` reproduces choices, but server deals and concurrent scheduling
are not deterministic. `--games flush`, `marriage`, `callbreak`, or a comma-separated
mixture controls the game types.

## Activity and pacing

Each randomly selected four-user group performs friend requests and acceptance,
direct messaging and notification reads; public/private room creation and
invitations; room entry and occasional leave/rejoin or visibility change; table
creation, invitation acceptance/decline and seat joining; occasional seat
leave/rejoin; room/table chat; locking where required; and manual game start.
Some groups send an active-game reaction. The host and guest order vary between
scenarios. An invitation answer and taking a seat are separate actions.

Once play starts, choose from the current player's authorized private projection.
Normal think time is uniformly 50–500 ms. `--late 0.005` delays 0.5% of moves by
2–5 seconds; `--late 0` disables deliberate delays. HTTP latency, move confirmation
latency, and fast/delayed dispatch timing are measured separately.
`fast_next_command_ms` includes waiting for the next actionable projection;
`moves.fast_over_1s` counts normal commands missing the one-second target. A sub-second
think time is not a guarantee of a sub-second response from an overloaded server.

- Call Break: shuffle, cut/skip, distribute, accept hands, bid, select legal cards,
  advance deals, and finish all five deals.
- Flush: deal, cut/skip, see, bet, fold, show/reveal and side-show request/answers,
  according to the allowed-action projection. Avoid early folding for the first
  12 moves and favor folding after 80 to bound a scenario.
- Marriage: declare no initial tunnelas, draw from an available source, discard
  legal cards and fold after 80 moves to exercise finalized fold wins. This is
  **not a solver for meld declarations or normal Marriage wins**.

This covers the listed core social/table/game flows, not every product command.
Rule proposals/votes, queues/seat offers, manual payment confirmation, played rematches,
normal Marriage wins, redeal claims, forced reconnects and multi-device conflicts
are not exercised. Per-command counters show actual coverage: a probabilistic run
cannot guarantee that every eligible action occurred. Manual mode has no player
turn deadline; deliberately late moves test delayed clients, not timer expiry.

## Validation and artifacts

After every naturally completed match/Flush round, reread all four player views
and require agreement on the public terminal game state and winners. Call Break
checks five completed deals, 13 tricks per deal, zero remaining cards, independently
recomputed bid scores/totals and winners. Flush checks payout/contribution
conservation and zero-sum net changes. Marriage checks public score agreement and
zero-sum net points.

Wait up to 30 seconds for the table's ledger entry. Require one result, unique
identity, expected game type, known participants, zero-sum balances and the exact
engine net amounts (or Call Break's configured placement payments). Call Break
with tied placement correctly requires no ledger entry; absence is observable,
but the HTTP API does not expose proof that the no-payment finalization job ran.
Validation is API-level consistency checking, not a complete independent engine
audit. Successful scenarios end Flush tables. Completed Marriage/Call Break tables
reject direct ending, so cleanup creates an unstarted next match and ends that
roster; the validated historical match is preserved. Guests then leave, the host
deletes the room and removes the created friendships. User accounts and retained
server history remain.

Results are written every ten seconds under `.loadtest/results/`:

- Timestamped JSON report: HTTP statuses, action counts, validations, failures,
  unique users and bounded latency histograms with approximate p50/p95/p99 upper
  bounds. HTTP time measures response headers; move confirmation measures the
  committed projection. It is not click-to-render browser timing.
- JSONL events: created room/table/match IDs, validation results, failure stage
  and command rejection diagnostics. Passwords, tokens and hand snapshots are not
  logged. Expected optional-chat 403 responses can appear in HTTP counts.
- Failed groups' `.journal.json` files preserve command IDs and unresolved intents
  for investigation. They are protected like reports and are not automatically
  replayed. Failed rooms/tables are deliberately retained rather than hidden by
  successful cleanup. Inspect their IDs and original command outcomes before
  reusing those accounts in another run.

Nonzero exit means a scenario failed, a fatal error occurred or no game completed.
Background delivery errors and slow requests remain visible in the report even
when a scenario recovers. A load result is meaningful only while the generator
itself has CPU/network headroom. This single-process runner has not been calibrated
at 20,000 concurrent sockets; use disjoint account files for separate generators.

## Local checks

```sh
node --experimental-strip-types --test scripts/loadtest/model.test.mts
POSTGRES_TEST_BIN=/path/to/postgres/bin \
REDIS_TEST_SERVER=/path/to/redis-server \
.venv/bin/python -m pytest -q tests/test_loadtest_native.py
```

The native test starts disposable PostgreSQL, Redis and two application gateways,
provisions 12 accounts, and drives one completed game of each type. A second
native test runs three concurrent Flush cohorts with deliberate delays. Without the
native binary environment variables it skips; policy/validator tests still run.

Local verification on 2026-09-28: 11 policy/validator tests and TypeScript passed;
full-game native acceptance passed (339.97 s), and the separate 12-user concurrent
Flush/delayed-command test passed (41.31 s). These are correctness smoke tests,
not a one-hour capacity result.
