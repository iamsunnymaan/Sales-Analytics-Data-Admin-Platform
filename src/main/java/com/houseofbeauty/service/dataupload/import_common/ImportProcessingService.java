package com.houseofbeauty.service.dataupload.import_common;

import com.houseofbeauty.service.common.TableAccessService;
import com.houseofbeauty.service.dataupload.tables.ImportBatchMaster;
import com.houseofbeauty.service.dataupload.tables.ImportPrimarySales;
import com.houseofbeauty.service.dataupload.tables.ImportPrimarySalesTarget;
import com.houseofbeauty.service.dataupload.tables.ImportProductMaster;
import com.houseofbeauty.service.dataupload.tables.ImportSecondarySales;
import com.houseofbeauty.service.dataupload.tables.ImportSecondarySalesTarget;
import com.houseofbeauty.service.dataupload.tables.ImportSiteMaster;
import com.houseofbeauty.service.dataupload.tables.ImportStock;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;

/**
 * Public entry point for running an uploaded file's rows against a target table, in fixed-size
 * chunks (see {@link ImportLimits}). Interprets the table's schema into a {@link RunContext} and then
 * hands off to one of two collaborators, depending on {@code dryRun}:
 * <ul>
 *     <li><b>Validation (dry run, Preview)</b> — {@link ImportValidationRunner}: up to
 *     {@link ImportLimits#MAX_PARALLEL_CHUNKS} chunks run concurrently, each attempting its inserts for
 *     real inside its own transaction that is always rolled back.</li>
 *     <li><b>Commit (real import)</b> — {@link ImportAtomicCommitRunner}: every chunk runs
 *     sequentially inside <i>one</i> transaction spanning the whole file — it either fully commits or
 *     fully rolls back, never partially.</li>
 * </ul>
 * Both collaborators share the same per-row/per-chunk engine ({@link ImportChunkRowProcessor}) and the
 * same thread-safe invalid-row budget for the whole run (see {@link ValidationState}): the moment the
 * 10th invalid/duplicate row is admitted, further work stops — no new chunks are scheduled,
 * already-running chunks stop at their next row check, and (for Commit) the entire transaction is
 * rolled back.
 */
@Service
public class ImportProcessingService {

    private final TableAccessService tableAccessService;
    private final JdbcTemplate jdbcTemplate;
    private final PlatformTransactionManager transactionManager;
    private final Executor chunkExecutor;
    private final ImportValidationRunner validationRunner;
    private final ImportAtomicCommitRunner commitRunner;
    private final ImportForeignKeyPreCheck foreignKeyPreCheck;

    public ImportProcessingService(TableAccessService tableAccessService, JdbcTemplate jdbcTemplate,
                                    PlatformTransactionManager transactionManager,
                                    @Qualifier("importChunkExecutor") TaskExecutor chunkExecutor) {
        this.tableAccessService = tableAccessService;
        this.jdbcTemplate = jdbcTemplate;
        this.transactionManager = transactionManager;
        this.chunkExecutor = chunkExecutor;

        ImportChunkRowProcessor rowProcessor = new ImportChunkRowProcessor(tableAccessService, jdbcTemplate);
        this.validationRunner = new ImportValidationRunner(tableAccessService, jdbcTemplate, transactionManager,
                chunkExecutor, rowProcessor);
        this.commitRunner = new ImportAtomicCommitRunner(tableAccessService, jdbcTemplate, transactionManager,
                rowProcessor);
        this.foreignKeyPreCheck = new ImportForeignKeyPreCheck(tableAccessService);
    }

    public enum RowStatus { VALID, DUPLICATE, INVALID }

    public record RowResult(int rowNumber, RowStatus status, Map<String, Object> data,
                             String errorColumn, String errorMessage, String solution) {
    }

    // reconciliationStatus/reconciliationDigest are only ever set on a real Commit run (see
    // ImportAtomicCommitRunner) — "VERIFIED"/"MISMATCH"/"SKIPPED" (see ImportCommitReconciler), or
    // both null for a Preview (dry-run) result, which never reaches the point of having anything to
    // reconcile.
    public record ImportRunResult(int totalRows, int inserted, int duplicates, int errors,
                                   String transactionStatus, List<String> effectiveHeaders,
                                   List<RowResult> rowResults, boolean cancelled, boolean invalidLimitReached,
                                   String reconciliationStatus, String reconciliationDigest) {
    }

    // Fired once per chunk as it finishes (chunks may complete out of row order during parallel
    // validation) so a caller can stream live progress back to the browser — see
    // ImportSessionController's status polling and DataUploadPage.js's progress bar.
    @FunctionalInterface
    public interface ProgressListener {
        void onProgress(int processedRows, int totalRows, int insertedSoFar, int duplicatesSoFar, int errorsSoFar);
    }

    // Fired for one specific chunk, twice: once as it starts ("running", rowsDone 0) and once as it
    // finishes ("passed"/"flagged"/"aborted", rowsDone = however many of its own rows were actually
    // processed before it stopped) — see ImportValidationRunner/ImportAtomicCommitRunner for exactly
    // when each fires. Feeds real per-chunk/lane data into ProcessStatusResponse/CommitStatusResponse
    // (see ImportProcessJobTracker.ChunkSlot) for any caller that wants it, rather than just
    // DataUploadPage.js's plain aggregate bar — optional (nullable) for callers that only care about
    // the aggregate ProgressListener above. No page currently renders this per-chunk detail (the
    // Verified Import page that was going to was removed 2026-08-24 before shipping); left in place
    // since it's real, tested, working data the engine already produces as part of its normal chunked
    // execution, not something built only for that page.
    @FunctionalInterface
    public interface ChunkProgressListener {
        void onChunkUpdate(int chunkIndex, String status, int rowsDone, int rowsTotal);
    }

    // Fired as each chunk finishes, with just that chunk's non-VALID (INVALID/DUPLICATE) rows — lets a
    // caller stream "invalid rows found so far" to the browser live, instead of only learning about
    // them once the whole run's final ImportRunResult comes back. Never fires for a chunk that found
    // nothing wrong. Bounded for free by the same per-table invalid-row budget that already stops the
    // whole run (see ValidationState) — this never needs its own cap.
    @FunctionalInterface
    public interface RowResultListener {
        void onRowResults(List<RowResult> newlyFound);
    }

    // Immutable, per-run table/column metadata — threaded through every chunk instead of a long,
    // repeated parameter list. Package-private: shared with ImportValidationRunner,
    // ImportAtomicCommitRunner and ImportChunkRowProcessor, all in this same package.
    record RunContext(String table, List<String> headers, Set<String> autoGeneratedColumns,
                       Set<String> identityColumns, boolean preserveIdentityValues,
                       Set<String> dateColumnsLower, Map<String, String> columnTypesLower,
                       List<String> duplicateCheckColumns, Map<Integer, Set<String>> precisionRiskCells,
                       Map<String, Long> appManagedPkBaseValues, List<String> rowOrderPkColumns) {
    }

    // Shared, thread-safe state for one run() call. invalidRowCount/invalidLimitSignal implement the
    // per-table invalid-row budget (see TableImportRules#invalidRowBudget, invalidRowBudget field
    // below, and ImportChunkRowProcessor.reserveInvalidSlot); userCancelled is the caller's own
    // cancel-button signal; seenKeysAcrossUpload replaces what used to be a fresh HashSet per chunk —
    // duplicate rows within the same file must be caught regardless of which chunk each copy landed
    // in, including when two chunks are validated concurrently.
    record ValidationState(AtomicInteger invalidRowCount, AtomicBoolean invalidLimitSignal,
                            BooleanSupplier userCancelled, Set<String> seenKeysAcrossUpload, int invalidRowBudget) {
        boolean invalidLimitReached() {
            return invalidLimitSignal.get();
        }

        boolean userCancelledNow() {
            return userCancelled != null && userCancelled.getAsBoolean();
        }

        boolean shouldStop() {
            return invalidLimitSignal.get() || userCancelledNow();
        }
    }

    record ChunkOutcome(int inserted, int duplicates, int errors, List<RowResult> rowResults,
                         boolean criticalFailure) {
    }

    // Every known table's own import rules (see TableImportRules) — one class per table under
    // .tables, not hardcoded here. Adding a new table's rule means adding its own class to this list,
    // not editing this engine file.
    private static final List<TableImportRules> TABLE_RULES = List.of(
            ImportPrimarySales.INSTANCE, ImportPrimarySalesTarget.INSTANCE, ImportBatchMaster.INSTANCE,
            ImportProductMaster.INSTANCE, ImportSiteMaster.INSTANCE, ImportStock.INSTANCE,
            ImportSecondarySales.INSTANCE, ImportSecondarySalesTarget.INSTANCE);

    // The tables whose rules declare alwaysInsertNew() true — every uploaded row always gets a
    // fresh, DB-generated (or app-managed sequential) key value and is never checked for duplicates.
    // See TableImportRules#alwaysInsertNew for the full explanation.
    private static final Set<String> ALWAYS_INSERT_NEW_TABLES = TABLE_RULES.stream()
            .filter(TableImportRules::alwaysInsertNew)
            .map(r -> r.tableKey().toLowerCase(Locale.ROOT))
            .collect(Collectors.toUnmodifiableSet());

    public boolean alwaysAutoGeneratesPrimaryKey(String table) {
        return ALWAYS_INSERT_NEW_TABLES.contains(table.toLowerCase(Locale.ROOT));
    }

    // Per-table invalid-row budget (see TableImportRules#invalidRowBudget) — tables with no rule
    // registered above (there are none currently, but this stays defensive) fall back to the global
    // ImportLimits.MAX_INVALID_ROWS default the same way TableImportRules#invalidRowBudget itself does.
    private static final Map<String, Integer> INVALID_ROW_BUDGETS = TABLE_RULES.stream()
            .collect(Collectors.toMap(r -> r.tableKey().toLowerCase(Locale.ROOT), TableImportRules::invalidRowBudget));

    public int invalidRowBudgetFor(String table) {
        return INVALID_ROW_BUDGETS.getOrDefault(table.toLowerCase(Locale.ROOT), ImportLimits.MAX_INVALID_ROWS);
    }

    public ImportRunResult run(String table, List<String> headers, List<List<String>> rows, boolean dryRun,
                                Map<Integer, Set<String>> precisionRiskCells) {
        return run(table, headers, rows, dryRun, precisionRiskCells, null, null, null);
    }

    public ImportRunResult run(String table, List<String> headers, List<List<String>> rows, boolean dryRun,
                                Map<Integer, Set<String>> precisionRiskCells, ProgressListener progressListener) {
        return run(table, headers, rows, dryRun, precisionRiskCells, progressListener, null, null);
    }

    public ImportRunResult run(String table, List<String> headers, List<List<String>> rows, boolean dryRun,
                                Map<Integer, Set<String>> precisionRiskCells, ProgressListener progressListener,
                                BooleanSupplier cancelled) {
        return run(table, headers, rows, dryRun, precisionRiskCells, progressListener, cancelled, null, null);
    }

    public ImportRunResult run(String table, List<String> headers, List<List<String>> rows, boolean dryRun,
                                Map<Integer, Set<String>> precisionRiskCells, ProgressListener progressListener,
                                BooleanSupplier cancelled, ChunkProgressListener chunkProgressListener) {
        return run(table, headers, rows, dryRun, precisionRiskCells, progressListener, cancelled,
                chunkProgressListener, null);
    }

    public ImportRunResult run(String table, List<String> headers, List<List<String>> rows, boolean dryRun,
                                Map<Integer, Set<String>> precisionRiskCells, ProgressListener progressListener,
                                BooleanSupplier cancelled, ChunkProgressListener chunkProgressListener,
                                RowResultListener rowResultListener) {
        return run(table, headers, rows, dryRun, precisionRiskCells, progressListener, cancelled,
                chunkProgressListener, rowResultListener, null);
    }

    // invalidRowBudgetOverride (null = use this table's own normal budget, see invalidRowBudgetFor)
    // exists for exactly one caller: the Data Preview card's "scan entire file & download all" option
    // (see ImportSessionController's /full-scan endpoint), which deliberately ignores the normal
    // fail-fast budget and substitutes ImportLimits.FULL_SCAN_ROW_BUDGET so the whole file gets
    // scanned instead of stopping at the first handful of bad rows.
    public ImportRunResult run(String table, List<String> headers, List<List<String>> rows, boolean dryRun,
                                Map<Integer, Set<String>> precisionRiskCells, ProgressListener progressListener,
                                BooleanSupplier cancelled, ChunkProgressListener chunkProgressListener,
                                RowResultListener rowResultListener, Integer invalidRowBudgetOverride) {
        RunContext ctx = buildRunContext(table, headers, precisionRiskCells);
        List<String> effectiveHeaders = headers.stream()
                .filter(h -> !ctx.autoGeneratedColumns().contains(h.toLowerCase(Locale.ROOT)))
                .toList();

        // Every table's own invalid-row tolerance (see TableImportRules#invalidRowBudget) — defaults to
        // ImportLimits.MAX_INVALID_ROWS when the table's rule doesn't override it.
        int invalidRowBudget = invalidRowBudgetOverride != null ? invalidRowBudgetOverride : invalidRowBudgetFor(table);

        // Fail fast on bad foreign-key references BEFORE ever touching the chunked insert engine — see
        // ImportForeignKeyPreCheck. A file with (say) one bad Bill_to repeated across hundreds of rows
        // would otherwise burn the entire invalid-row budget on identical repeats of the same root
        // cause, hiding every other distinct problem. Empty when every reference in the file resolves
        // cleanly (the overwhelmingly common case), in which case this is a no-op.
        List<RowResult> missingReferences = foreignKeyPreCheck.run(table, headers, ctx.autoGeneratedColumns(), rows);
        if (!missingReferences.isEmpty()) {
            return foreignKeyPreCheckFailure(rows.size(), effectiveHeaders, missingReferences, invalidRowBudget);
        }

        // Fresh, call-scoped state — every run() invocation (i.e. every upload attempt) gets its own
        // counter/cancellation-signal/duplicate-key set with nothing shared across calls, which is
        // what keeps concurrent uploads isolated from each other (see ImportLimits' Upload Isolation
        // note) without needing an explicit uploadId: two different run() calls simply never share
        // any of these objects.
        ValidationState state = new ValidationState(new AtomicInteger(), new AtomicBoolean(), cancelled,
                ConcurrentHashMap.newKeySet(), invalidRowBudget);

        return dryRun
                ? validationRunner.run(ctx, rows, progressListener, state, effectiveHeaders, chunkProgressListener,
                        rowResultListener)
                : commitRunner.run(ctx, rows, progressListener, state, effectiveHeaders, chunkProgressListener,
                        rowResultListener);
    }

    // One RowResult per DISTINCT missing referenced value (see ImportForeignKeyPreCheck), capped at
    // this table's invalid-row budget same as the normal engine's own budget — kept small deliberately
    // since each entry already represents a whole class of bad rows, not a single one.
    // invalidLimitReached is always true here (regardless of how many distinct values were actually
    // found) so the session is correctly marked "Failed" rather than "Validated" — nothing else in the
    // file has been checked yet, since the normal engine never ran this attempt.
    private ImportRunResult foreignKeyPreCheckFailure(int totalRows, List<String> effectiveHeaders,
                                                        List<RowResult> missingReferences, int invalidRowBudget) {
        List<RowResult> capped = missingReferences.size() > invalidRowBudget
                ? missingReferences.subList(0, invalidRowBudget)
                : missingReferences;
        return new ImportRunResult(totalRows, 0, 0, capped.size(), "Failed", effectiveHeaders, capped, false, true,
                null, null);
    }

    /**
     * Classifies the target table's columns for this run: which are auto-generated (identity,
     * computed, or an app-managed "SN"/no-dup-check primary key), which participate in duplicate
     * checking, and which date columns need text normalization. This is the one place {@code run()}'s
     * inputs get turned into the immutable {@link RunContext} both {@link ImportValidationRunner} and
     * {@link ImportAtomicCommitRunner} operate on.
     */
    private RunContext buildRunContext(String table, List<String> headers,
                                        Map<Integer, Set<String>> precisionRiskCells) {
        List<String> primaryKeyColumns = tableAccessService.getPrimaryKeyColumns(table);
        Set<String> identityColumns = tableAccessService.getIdentityColumns(table);
        Set<String> identityColumnsLower = ImportValueNormalizer.lower(identityColumns);
        // Computed columns (e.g. primary_sales.Sales = NetValue + GST) can never be given an
        // explicit value at all, unlike an identity column — so they're always excluded below,
        // regardless of alwaysAutoGenerate/headers, with no "preserve if the file supplies it" case.
        Set<String> computedColumnsLower = ImportValueNormalizer.lower(tableAccessService.getComputedColumns(table));
        Set<String> headersLower = ImportValueNormalizer.lower(headers);
        boolean alwaysAutoGenerate = ALWAYS_INSERT_NEW_TABLES.contains(table.toLowerCase(Locale.ROOT));
        Map<String, String> columnTypesOriginalCase = tableAccessService.getColumnTypes(table);
        Map<String, String> columnTypesLower = columnTypesOriginalCase.entrySet().stream()
                .collect(Collectors.toMap(e -> e.getKey().toLowerCase(Locale.ROOT), Map.Entry::getValue));
        Set<String> dateColumnsLower = columnTypesLower.entrySet().stream()
                .filter(e -> DATE_COLUMN_TYPES.contains(e.getValue()))
                .map(Map.Entry::getKey)
                .collect(Collectors.toSet());
        Set<String> autoGeneratedColumns = new HashSet<>(alwaysAutoGenerate
                ? identityColumnsLower
                : identityColumnsLower.stream().filter(c -> !headersLower.contains(c)).collect(Collectors.toSet()));
        autoGeneratedColumns.addAll(computedColumnsLower);
        boolean preserveIdentityValues = !alwaysAutoGenerate
                && identityColumnsLower.stream().anyMatch(headersLower::contains);

        // CHANGED: ANY table with a column literally named "SN" (case-insensitive) that isn't a real
        // DB identity column always gets it auto-generated — current MAX(SN)+1, incrementing
        // sequentially per row in file order — the file's own SN values, if any, are ignored rather
        // than preserved. This is also what TableDataController.resolveOrder defaults grid/export
        // ordering to (see that class): every table with an SN column gets its uploaded Excel row
        // order preserved for free through this same mechanism.
        String snColumn = columnTypesOriginalCase.keySet().stream()
                .filter(c -> c.equalsIgnoreCase("SN"))
                .findFirst().orElse(null);
        Map<String, Long> appManagedPkBaseValues = new LinkedHashMap<>();
        if (snColumn != null && !identityColumnsLower.contains(snColumn.toLowerCase(Locale.ROOT))) {
            autoGeneratedColumns.add(snColumn.toLowerCase(Locale.ROOT));
            appManagedPkBaseValues.put(snColumn, tableAccessService.getNextNumericColumnValue(table, snColumn));
        }
        // Any OTHER non-identity primary-key column on an alwaysAutoGenerate table, not already
        // covered by the SN rule above.
        if (alwaysAutoGenerate) {
            for (String column : primaryKeyColumns) {
                if (!identityColumnsLower.contains(column.toLowerCase(Locale.ROOT))
                        && !appManagedPkBaseValues.containsKey(column)) {
                    autoGeneratedColumns.add(column.toLowerCase(Locale.ROOT));
                    appManagedPkBaseValues.put(column, tableAccessService.getNextNumericColumnValue(table, column));
                }
            }
        }

        // Duplicate-checking only makes sense against a PK the file actually supplies a value for;
        // a still-auto-generated identity (or app-managed) PK has nothing to compare against.
        List<String> duplicateCheckColumns = primaryKeyColumns.stream()
                .filter(c -> !autoGeneratedColumns.contains(c.toLowerCase(Locale.ROOT)))
                .toList();

        // The business-key PK column(s) whose upload-file position gets recorded into
        // table_row_order for TableDataController's default sort (see ImportAtomicCommitRunner) —
        // only when the table has no SN column (which already solves this via a real, persisted,
        // monotonic column — see the snColumn block above) and NONE of its PK columns are themselves
        // DB/app-generated (an identity or app-managed PK is already inserted in a deterministic,
        // order-preserving sequence, so it doesn't need this). Supports composite PKs (e.g.
        // site_master's (Site_Code, Brand), added 2026-09-02) — every PK column's value gets
        // concatenated into one composite tracking key (see ImportAtomicCommitRunner.recordRowOrder),
        // in the same column order as TableAccessService.getPrimaryKeyColumns (ORDINAL_POSITION),
        // which TableDataController's read side (buildFromAndOrderBy) also uses — both sides agree on
        // ordering because both ultimately call that same method.
        List<String> rowOrderPkColumns = List.of();
        if (snColumn == null && !primaryKeyColumns.isEmpty()
                && primaryKeyColumns.stream().noneMatch(c -> autoGeneratedColumns.contains(c.toLowerCase(Locale.ROOT)))) {
            rowOrderPkColumns = primaryKeyColumns;
        }

        return new RunContext(table, headers, autoGeneratedColumns, identityColumns, preserveIdentityValues,
                dateColumnsLower, columnTypesLower, duplicateCheckColumns, precisionRiskCells,
                appManagedPkBaseValues, rowOrderPkColumns);
    }

    private static final Set<String> DATE_COLUMN_TYPES = Set.of("date", "datetime", "timestamp");
}
