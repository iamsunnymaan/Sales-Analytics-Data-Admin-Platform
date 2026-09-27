  # Testing Guide

## Run the tests

```
./mvnw test
```

## What's covered

All tests are Mockito-based unit tests under `src/test/java/com/houseofbeauty/service/` — there's no
in-memory test database (the app talks to MySQL directly via `mysql-connector-j`), so JDBC/transaction
infrastructure is mocked rather than hit for real.

| Test class | Covers |
|---|---|
| `ImportSessionCleanupServiceTest` | The daily (midnight) cron job that deletes yesterday-or-older Upload History rows and their stored files. |
| `TableAccessServiceTest` | SQL building for insert/update/delete/select, hidden-table filtering, non-comparable column handling (text/ntext/image). |
| `ImportProcessingServiceTest` | The chunked import engine: valid inserts, duplicate detection, dry-run rollback (Preview), date normalization, batch-insert failure fallback, critical failures, identity-column handling. |

## Conventions used

- `@ExtendWith(MockitoExtension.class)` + `@Mock` fields — no Spring context is started, so tests run fast.
- Test method names read as `scenario_expectedOutcome` — the comment above each `@Test` adds the *why*
  when it isn't obvious from the name alone.
- `ArgumentCaptor` is used wherever the exact generated SQL or bound parameters matter (see
  `TableAccessServiceTest`), so a change to query-building logic is caught even if the mocked return
  value would otherwise let the test pass.
