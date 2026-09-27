# Backend Overview

Short explanation of the main pieces under `src/main/java/com/houseofbeauty/` — for the full behavior,
read the Javadoc comments on each class, which explain the *why* behind the trickier decisions.

## Upload flow

1. **Upload** (`ImportSessionController.upload`) — saves the raw CSV/XLSX file to disk and records an
   `ImportSession` row (status `Uploaded`).
2. **Preview** (`ImportSessionController.process`) — runs the real import logic (`ImportProcessingService`)
   inside transactions that always roll back, so what you see in the preview is exactly what a real
   import would do.
3. **Commit** (`ImportSessionController.commit`) — runs the same logic for real; chunks commit unless a
   critical failure occurs.

## Key services

- **`TableAccessService`** — the only place that builds raw SQL against the target tables (insert,
  update, delete, duplicate lookup). Hides `HIDDEN_TABLES` (internal/system tables) from every endpoint.
- **`ImportProcessingService`** — processes an uploaded file's rows in fixed-size chunks, each its own
  transaction. Handles duplicate detection, identity-column preservation, and per-row error reporting.
- **`ImportSessionCleanupService`** — daily cron job (`@Scheduled`, runs at midnight) that deletes Upload History rows
  (and their files) once they're no longer "today's" data. Also runs once on app startup (`@PostConstruct`), since a
  missed midnight trigger (app not running at that instant) is never retried by Spring on its own — see
  `doc/TESTING.md` for its test coverage.

## Tables that are never exposed

`target_master`, `target_master_log`, `transactional_log`, `user_master`, `user_role_master`, and
`import_sessions` are excluded from Explorer/Upload/every generic table endpoint — see
`TableAccessService.HIDDEN_TABLES`.
