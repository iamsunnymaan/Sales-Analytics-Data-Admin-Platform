# Performance Testing Plan

Covers the checklist: page load time, API response time, DB query performance, normal/high/concurrent
user load, stress/load/spike testing, memory/CPU usage, large file handling, large data-volume testing.

This is a **plan to execute manually or via scripted tools** — nothing here has been run yet. See
`TESTING.md` for the existing unit-test suite (functional correctness only, no perf coverage).

## Why this app needs a tailored plan, not a generic one

- Single Spring Boot instance (`server.port=8080`), no load balancer / clustering config found — all
  load in these tests hits one JVM and one MySQL connection pool.
- No `spring.datasource.hikari.*` overrides in any `application*.properties` → HikariCP defaults apply,
  i.e. **max pool size 10**. This is the most likely first bottleneck under concurrent load, not app code.
- `spring.jpa.hibernate.ddl-auto=none` and real FKs were added 2026-08-11 ([[project_upload_fixes_and_real_fk_constraints_2026_08_11]] if you keep memory context) — write-heavy endpoints (import commit) now pay FK-check cost that didn't exist before.
- File upload cap is `25MB` (`spring.servlet.multipart.max-file-size/max-request-size`) — large-file
  testing should target at/near this ceiling, not arbitrary sizes.
- The import pipeline (`ImportSessionController`) is chunked with parallel validation and a single
  atomic commit transaction — this is the endpoint most likely to show non-linear degradation as row
  count grows, and the one place a stress test could do real damage (long-held transaction/locks).
- As of the last DB wipe, core tables are empty — **load tests need a seeded dataset first**, or results
  are meaningless (see "Test data" below).

## Target endpoints (from current controllers)

| Area | Endpoint | Why it matters for perf |
|---|---|---|
| Dashboards | `GET /api/primary-sales/trend-range`, `/monthly`, `/monthly/breakdown`, `/reports/channels`, `/reports/brand-hierarchy` | Aggregation queries over sales data; grow with row count and date-range width |
| Dashboards | `GET /api/inventory/overview` | Cross-table aggregation (per project scope: joins across the 8 locked tables) |
| Quick panel | `GET /api/top-projection` | Likely N-largest query, sensitive to missing indexes |
| Grid/Explorer | `GET /api/database/tables/{tableName}/data` | Generic paged table read — check pagination is real (LIMIT/OFFSET at SQL level) not fetch-all-then-slice |
| Grid/Explorer | `GET /api/database/tables/{tableName}/export` | Unbounded export — largest single-request payload risk |
| Import | `POST /api/import-sessions/upload` | Large file upload, 25MB cap |
| Import | `POST /api/import-sessions/{id}/process` | Chunked validation — CPU + memory bound |
| Import | `POST /api/import-sessions/{id}/commit` | Single atomic transaction — lock/duration risk under concurrent commits |

## Tools

- **k6** (recommended) — scriptable, good for load/stress/spike with clear thresholds, free.
- **Apache JMeter** — if the team already knows it / needs a GUI.
- **MySQL**: `EXPLAIN ANALYZE` for the queries backing the endpoints above; the slow query log and
  `SHOW PROCESSLIST` for server-side load during a run.
- **JVM**: `jconsole`/`VisualVM` attached to the running app, or `spring-boot-starter-actuator`
  (not currently a dependency — add temporarily for `/actuator/metrics`, `/actuator/prometheus` if
  deeper heap/GC/thread-pool visibility is needed; remove or lock down before shipping).
- **OS**: Task Manager / Resource Monitor for process-level CPU and memory during each run.

## Test data

Load/stress numbers are meaningless against an empty DB. Before running:
1. Restore or generate a representative dataset in the 8 in-scope tables (`sample_data/` in the repo
   root looks like a starting point — verify row counts against realistic production volume first).
2. Record the row count per table used for each test run — a "trend-range" query over 1K rows and over
   1M rows are different tests; report them separately, don't average.

## 1. Page load time

- Measure via browser DevTools Network tab (or Lighthouse) for each dashboard page: Overview, Primary
  Sales, Inventory, Data Upload, Database Explorer.
- Record: Time to First Byte, DOMContentLoaded, full load, and count/size of API calls fired on page load.
- Target: TTFB < 200ms on an idle server; full interactive < 3s on broadband for each dashboard.

## 2. API response time

- Hit each endpoint in the table above individually (single user, warm JVM — run each request 2-3x
  first and discard, since first-hit includes JIT/connection-pool warmup).
- Record p50/p95/p99 over 50-100 requests per endpoint.
- Target: reporting/dashboard GETs < 500ms p95; `/export` and `/upload` are expected to be slower and
  should be measured separately against file/row size, not a flat target.

## 3. Database query performance

- For each dashboard/report endpoint, capture the actual MySQL query (enable logging or use
  the slow query log) and run it directly with `EXPLAIN ANALYZE`.
- Get the execution plan; flag any table scan on a table that should be filtered by an indexed column
  (especially date-range filters used across Primary Sales endpoints, and brand filters on Overview).
- Target: no query backing a dashboard endpoint should do a full scan on a table beyond a few thousand
  rows without an index justifying it.

## 4-5. Normal and high user load

- k6 scenario: ramp from 1 → N virtual users hitting a realistic mix of the dashboard endpoints
  (not just one), holding steady for 5 minutes at each step.
- "Normal" = expected concurrent internal users (ask the business owner for a real number rather than
  guessing — this is an internal admin tool, likely single digits to low tens, not public-internet scale).
- "High" = 3-5x that number, to find the first point of degradation.
- Record response time and error rate at each step; note the VU count where p95 crosses your target
  or errors start appearing.

## 6. Concurrent users

- Specifically test concurrent **writes**: multiple simultaneous import commits (`POST
  /api/import-sessions/{id}/commit`) and concurrent grid edits via `TableDataController`, since these
  hold DB transactions and share the 10-connection Hikari pool with every read endpoint.
- Watch for: connection pool exhaustion (requests queueing/timing out), FK-constraint deadlocks, and
  whether one long-running import commit visibly slows down unrelated dashboard reads during the run.

## 7. Stress testing

- Push VUs well past the "high load" number from step 5 until the app degrades or errors, to find the
  actual ceiling and the failure mode (slow responses vs. hard errors vs. connection pool timeouts).
- **Run this against a local/dev instance only, never production** — stress testing is inherently
  disruptive and this is a live business admin tool.

## 8. Load testing

- Sustained load at the "normal" VU count for an extended window (30-60 min) to catch degradation over
  time (connection leaks, memory growth) that a short burst test won't show.

## 9. Spike testing

- Sudden jump from idle to the "high load" VU count with no ramp, then back to idle. Checks whether the
  connection pool and JVM recover cleanly rather than staying degraded after the spike passes.

## 10. Memory usage

- Attach VisualVM/jconsole (or actuator if added) during load/stress/spike runs.
- Watch heap after each GC cycle across the run — a rising floor after each collection indicates a leak.
- Pay particular attention to the import pipeline (`ImportSessionController` / `ImportProcessingService`)
  and `/export` — both read whole files/result sets into memory by nature of using POI/OpenCSV, so are
  the most likely place for memory pressure under large-file or large-export tests.

## 11. CPU usage

- Task Manager or Perfmon during each load/stress step; correlate CPU spikes with which endpoint was
  under test. XLSX parsing (Apache POI) and CSV parsing are CPU-heavy compared to plain JSON endpoints
  — expect them to dominate CPU during import tests.

## 12. Large file handling

- Test uploads at 1MB, 10MB, and right at/just over the 25MB cap (expect a clean 4xx rejection at the
  ceiling, not a hang or 500).
- Measure upload time, validation time (`/process`), and commit time separately — they're different
  phases with different bottlenecks (I/O, CPU parsing, DB transaction respectively).
- Confirm the app's row-count practical limit for a 25MB CSV/XLSX (row count varies a lot by column
  count) and document it, since the multipart size cap doesn't map directly to a row-count cap.

## 13. Large database / data-volume testing

- Re-run the "API response time" and "database query performance" tests (sections 2-3) at multiple
  data volumes: current size, 10x, and a realistic worst-case projection (ask the business for expected
  growth over 1-2 years) — to see which endpoints scale linearly vs. which degrade non-linearly and need
  an index or query rewrite before that volume is reached.

## Reporting

For each test, record: date, git commit hash, dataset row counts used, VU/load profile, and p50/p95/p99
+ error rate. Keep results in a dated file (e.g. `doc/perf-results/2026-08-20.md`) rather than overwriting
one running doc, so regressions/improvements are comparable over time.
