package com.houseofbeauty.service.dataupload.import_common;

/**
 * A table's own import rules — implemented once per table under
 * {@code com.houseofbeauty.service.dataupload.tables}, and read by {@link ImportProcessingService}
 * instead of hardcoding table names in the engine itself. Adding a new per-table rule means adding
 * (or editing) that table's own class, not touching this engine.
 */
public interface TableImportRules {

    /** The exact table name this rule set applies to (matches {@code TableAccessService.validateTable}'s output). */
    String tableKey();

    /**
     * True for a table whose primary key is a surrogate with no business meaning (e.g. a plain
     * row-counter SN), or which has no primary key at all, rather than a real business key — every uploaded row is always
     * inserted as new, never checked for duplicates, and any such non-identity primary key column is
     * always app-managed: the file's own value is ignored, and the database gets a fresh sequential
     * value continuing from whatever's already there (current MAX+1), incrementing by one per row in
     * file order (see {@link ImportProcessingService#buildRunContext}'s {@code alwaysAutoGenerate}
     * branch for exactly how this is applied).
     *
     * <p>False (the default) means the opposite: the table's real primary key (as read live from the
     * database — see {@code TableAccessService#getPrimaryKeyColumns}) IS a genuine business key, so
     * the engine's normal duplicate check applies — a row whose key already exists in the table is
     * skipped as a duplicate rather than re-inserted.
     */
    default boolean alwaysInsertNew() {
        return false;
    }

    /**
     * How many invalid/duplicate rows a single upload attempt against this table may accumulate
     * before the engine stops scanning and fails the attempt (see
     * {@code ImportChunkRowProcessor#reserveInvalidSlot} / {@link ImportLimits#MAX_INVALID_ROWS}).
     * Defaults to the global {@link ImportLimits#MAX_INVALID_ROWS} — override only when a specific
     * table genuinely warrants a different tolerance (e.g. a much higher-volume table where a
     * stricter global default would make routine uploads impractically fragile).
     */
    default int invalidRowBudget() {
        return ImportLimits.MAX_INVALID_ROWS;
    }
}
