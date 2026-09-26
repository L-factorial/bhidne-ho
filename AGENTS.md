# Branch scope: distributed runtime

When working on `bhidne-ho-scalability`:

- Keep work limited to the agreed distributed-runtime implementation and its
  directly related tests and documentation. Do not include unrelated fixes or
  refactors unless the user explicitly changes the scope.
- Read `docs/distributed-runtime-plan.md` before starting each increment. Its
  checklist and handoff notes are the implementation baseline.
- Work in reviewable increments; do not enable partially implemented distributed
  behavior in the existing runtime.
- Update the plan after each increment with completed work, verification,
  limitations, design decisions, and the exact next step.
- Capacity testing, observability, database HA deployment, and operational
  readiness remain the next task set unless the user requests them sooner.

The user has authorized incremental implementation on this branch. The original
planning-only restriction no longer blocks work within this agreed scope.
