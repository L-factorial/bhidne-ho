# Client diagnostics

The client retains the latest 300 diagnostic events in memory. Older entries are
removed automatically; restarting the app clears the buffer. Nothing is written
to disk or uploaded. `recentDiagnostics()` returns an independent snapshot and
`clearDiagnostics()` clears the buffer (client/src/diagnostics/events.ts).

Development consoles show all events. Production consoles show warnings and
errors; successful requests and transitions remain available in the bounded
buffer. Each request has an ID and elapsed time. Shared HTTP requests distinguish
10-second timeouts from caller cancellation. Distributed HTTP requests report
caller cancellation without guessing whether the caller's deadline expired.

Coverage: shared and distributed HTTP transport outcomes, message send events on
shared message endpoints, room and distributed socket connection lifecycle,
app foreground/background state, root screens and lobby tabs, uncaught JavaScript
errors through React Native's existing global handler, and web unhandled errors
and promise rejections. Existing fatal-error handling is preserved.

No request/response bodies, direct message contents, user names, credentials,
URLs, socket frames, raw exceptions or stack traces are recorded. Diagnostic
metadata uses an explicit scalar field allowlist. Do not pass user-supplied text
into screen/state/operation labels.

This is initial diagnostic instrumentation, not crash reporting. It does not
capture native process crashes, every caught application error, every nested
screen transition, or native unhandled promise rejections. A process crash loses
the memory buffer; there is no export UI or remote reporting integration yet.
