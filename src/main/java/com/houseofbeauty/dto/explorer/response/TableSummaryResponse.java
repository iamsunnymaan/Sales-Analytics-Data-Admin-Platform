package com.houseofbeauty.dto.explorer.response;

import java.time.LocalDateTime;

/**
 * GET /api/database/tables/{tableKey}/summary's response — backs the Data Upload page's "Available
 * Tables" info panel (icon+name, last import date, duplicate-check status) for whichever table is
 * currently selected.
 *
 * <p>{@code lastUpdated} is the most recent COMMITTED upload's timestamp for this table — read from
 * table_last_import (a real permanent per-table record, see TableAccessService#getLastImportedAt),
 * falling back to ImportSessionRepository's own transient same-day history when that table has no
 * row yet for this table. {@code null} means the table has genuinely never been imported into via
 * this app (or was, before table_last_import existed, and it's now also aged out of
 * ImportSessionRepository's one-day retention window — see ImportSessionCleanupService), not
 * necessarily that the table itself is empty or untouched.
 *
 * <p>{@code duplicateCheckEnabled} mirrors {@code ImportProcessingService#alwaysAutoGeneratesPrimaryKey}
 * inverted — false for a table whose primary key is a surrogate with no business meaning (every
 * uploaded row is always inserted as new, never checked for duplicates; see
 * {@code TableImportRules#alwaysInsertNew}), true for a table with a genuine business-key primary key
 * (a re-uploaded row whose key already exists is skipped as a duplicate).
 */
public record TableSummaryResponse(String name, LocalDateTime lastUpdated, boolean duplicateCheckEnabled) {
}
