package com.houseofbeauty.service.dataupload.import_common;

import com.houseofbeauty.service.common.TableAccessService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Commit (real import): every chunk runs sequentially inside <i>one</i> transaction spanning the whole
 * file. A known-bad row (already flagged invalid/duplicate) is simply excluded from the INSERT the
 * same way it always has been, but the transaction as a whole either fully commits or fully rolls
 * back — there is no way for some chunks to land while others fail, which is what "atomic" means here.
 * Sequential by design (one JDBC connection/transaction for the whole commit), unlike
 * {@link ImportValidationRunner}'s bounded-parallel Preview — see
 * {@link ImportChunkRowProcessor#processChunkCore} for why a single connection can't be shared
 * concurrently.
 */
class ImportAtomicCommitRunner {

    private final TableAccessService tableAccessService;
    private final JdbcTemplate jdbcTemplate;
    private final PlatformTransactionManager transactionManager;
    private final ImportChunkRowProcessor rowProcessor;
    private final ImportCommitReconciler reconciler;

    ImportAtomicCommitRunner(TableAccessService tableAccessService, JdbcTemplate jdbcTemplate,
                              PlatformTransactionManager transactionManager, ImportChunkRowProcessor rowProcessor) {
        this.tableAccessService = tableAccessService;
        this.jdbcTemplate = jdbcTemplate;
        this.transactionManager = transactionManager;
        this.rowProcessor = rowProcessor;
        this.reconciler = new ImportCommitReconciler(jdbcTemplate);
    }

    ImportProcessingService.ImportRunResult run(ImportProcessingService.RunContext ctx, List<List<String>> rows,
                                                 ImportProcessingService.ProgressListener progressListener,
                                                 ImportProcessingService.ValidationState state,
                                                 List<String> effectiveHeaders,
                                                 ImportProcessingService.ChunkProgressListener chunkProgressListener,
                                                 ImportProcessingService.RowResultListener rowResultListener) {
        int totalRows = rows.size();
        List<List<List<String>>> chunks = ImportValueNormalizer.partition(rows, ImportLimits.CHUNK_SIZE);
        // Commit never simulates an identity value — a real insert either preserves the file's own
        // identity values (if the file supplied them) or lets the database generate them for real.
        boolean needsIdentityInsert = ctx.preserveIdentityValues();

        int[] insertedHolder = {0};
        int[] duplicatesHolder = {0};
        int[] errorsHolder = {0};
        List<ImportProcessingService.RowResult> rowResultsHolder = new ArrayList<>();
        boolean[] criticalFailureHolder = {false};

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);

        try {
            tx.execute(status -> {
                if (needsIdentityInsert) {
                    tableAccessService.setIdentityInsert(ctx.table(), true);
                }
                try {
                    int rowNumber = 0;
                    int chunkIndex = 0;
                    for (List<List<String>> chunk : chunks) {
                        // Sequential by design (one JDBC connection/transaction for the whole commit —
                        // see the class javadoc on why this never runs chunks concurrently the way
                        // validation does), but still checked between every chunk so a cap/cancel hit
                        // partway through a huge file stops the remaining chunks from ever running.
                        if (state.shouldStop()) {
                            break;
                        }
                        int startingRowNumber = rowNumber;
                        int chunkSize = chunk.size();
                        rowNumber += chunkSize;
                        int idx = chunkIndex++;
                        if (chunkProgressListener != null) {
                            chunkProgressListener.onChunkUpdate(idx, "running", 0, chunkSize);
                        }

                        ImportProcessingService.ChunkOutcome outcome =
                                rowProcessor.processChunkCore(ctx, state, chunk, startingRowNumber, false);
                        insertedHolder[0] += outcome.inserted();
                        duplicatesHolder[0] += outcome.duplicates();
                        errorsHolder[0] += outcome.errors();
                        rowResultsHolder.addAll(outcome.rowResults());
                        if (progressListener != null) {
                            progressListener.onProgress(rowNumber, totalRows, insertedHolder[0],
                                    duplicatesHolder[0], errorsHolder[0]);
                        }
                        if (chunkProgressListener != null) {
                            // Same classification ImportValidationRunner uses — see its javadoc comment
                            // at the equivalent call for why "didn't finish all its own rows" is
                            // "aborted" rather than "flagged".
                            String chunkStatus = outcome.criticalFailure() || outcome.rowResults().size() < chunkSize
                                    ? "aborted"
                                    : (outcome.errors() > 0 || outcome.duplicates() > 0) ? "flagged" : "passed";
                            chunkProgressListener.onChunkUpdate(idx, chunkStatus, outcome.rowResults().size(), chunkSize);
                        }
                        if (rowResultListener != null) {
                            List<ImportProcessingService.RowResult> notValid = outcome.rowResults().stream()
                                    .filter(r -> r.status() != ImportProcessingService.RowStatus.VALID)
                                    .toList();
                            if (!notValid.isEmpty()) {
                                rowResultListener.onRowResults(notValid);
                            }
                        }
                    }
                } finally {
                    if (needsIdentityInsert) {
                        tableAccessService.setIdentityInsert(ctx.table(), false);
                    }
                }

                // The one decision point for the whole commit: anything short of a clean, in-budget
                // run rolls back everything committed so far in this transaction — there is no
                // partially-imported outcome. A critical failure can't be observed here (it would
                // have propagated out of the try block above and been caught below instead).
                if (state.shouldStop()) {
                    status.setRollbackOnly();
                }
                return null;
            });
        } catch (Exception criticalEx) {
            // Spring has already rolled the whole transaction back at this point — nothing from any
            // chunk (including ones that looked clean moments ago) actually landed.
            criticalFailureHolder[0] = true;
            if (rowResultsHolder.isEmpty()) {
                String rootMessage = ImportValueNormalizer.rootCauseMessage(criticalEx);
                for (int i = 0; i < totalRows; i++) {
                    rowResultsHolder.add(new ImportProcessingService.RowResult(i + 1,
                            ImportProcessingService.RowStatus.INVALID, Map.of(), null,
                            "System failure while processing this upload: " + rootMessage,
                            "This wasn't a data problem — retry the import; if it keeps failing, check the database connection."));
                }
                errorsHolder[0] = totalRows;
            }
        }

        boolean invalidLimitReached = state.invalidLimitReached();
        boolean wasCancelled = !invalidLimitReached && !criticalFailureHolder[0] && state.userCancelledNow();
        boolean aborted = criticalFailureHolder[0] || invalidLimitReached || wasCancelled;
        int finalInserted = aborted ? 0 : insertedHolder[0];

        if (!aborted && !ctx.rowOrderPkColumns().isEmpty()) {
            recordRowOrder(ctx, rowResultsHolder);
        }
        // table_last_import — real, permanent "last import" record for the Explorer page's own
        // table-info panel (see TableAccessService#recordLastImport's own comment for why this exists
        // alongside the transient import_sessions.committedAt). Every table gets this, not gated by
        // rowOrderPkColumns like recordRowOrder above (that one's specific to tables missing a sort
        // key; this one applies to any real commit).
        if (!aborted) {
            tableAccessService.recordLastImport(ctx.table());
        }

        // Verify — real post-commit reconciliation (see ImportCommitReconciler), run only now that
        // tx.execute() above has actually returned (the transaction template commits at that point) —
        // re-reading the rows as a fresh query would see them, not from inside the same transaction
        // that just wrote them. Nothing to reconcile for an aborted attempt (rolled back, so zero rows
        // actually landed) or when nothing was inserted at all.
        ImportCommitReconciler.Result reconciliation = (!aborted && finalInserted > 0)
                ? reconciler.reconcile(ctx, rowResultsHolder, tableAccessService)
                : ImportCommitReconciler.Result.skipped();

        String transactionStatus;
        if (wasCancelled) {
            transactionStatus = "Cancelled";
        } else if (invalidLimitReached || criticalFailureHolder[0]) {
            transactionStatus = "Failed";
        } else if (errorsHolder[0] == 0) {
            transactionStatus = "Committed";
        } else if (insertedHolder[0] == 0) {
            transactionStatus = "Failed";
        } else {
            transactionStatus = "Committed with errors";
        }

        return new ImportProcessingService.ImportRunResult(totalRows, finalInserted, duplicatesHolder[0],
                errorsHolder[0], transactionStatus, effectiveHeaders, rowResultsHolder, wasCancelled,
                invalidLimitReached, reconciliation.status().name(), reconciliation.expectedDigest());
    }

    // Best-effort — table_row_order only feeds TableDataController's default sort order, not the
    // already-committed import itself, so a failure here must never fail (or appear to fail) the
    // upload. rowResults' data map is keyed by the file's own literal header text (see
    // ImportChunkRowProcessor), which may not match the DB column's exact casing, so each matching
    // header is looked up case-insensitively rather than indexing by ctx.rowOrderPkColumns() directly.
    // Supports composite PKs (e.g. site_master's (Site_Code, Brand)): every PK column's value for a
    // row is joined with TableAccessService.ROW_ORDER_KEY_DELIMITER into one composite tracking key —
    // TableDataController.buildFromAndOrderBy's read side builds the exact same concatenation
    // (CHAR(31)) in the same column order, so both sides agree.
    private void recordRowOrder(ImportProcessingService.RunContext ctx,
                                 List<ImportProcessingService.RowResult> rowResults) {
        List<String> pkHeaders = new ArrayList<>();
        for (String pkColumn : ctx.rowOrderPkColumns()) {
            String header = ctx.headers().stream()
                    .filter(h -> h.equalsIgnoreCase(pkColumn))
                    .findFirst().orElse(null);
            if (header == null) {
                return;
            }
            pkHeaders.add(header);
        }
        Map<String, Long> pkValueToSeq = new LinkedHashMap<>();
        for (ImportProcessingService.RowResult result : rowResults) {
            if (result.status() != ImportProcessingService.RowStatus.VALID) {
                continue;
            }
            List<Object> pkValues = pkHeaders.stream().map(header -> result.data().get(header)).toList();
            if (pkValues.stream().anyMatch(Objects::isNull)) {
                continue;
            }
            String compositeKey = pkValues.stream()
                    .map(String::valueOf)
                    .collect(Collectors.joining(String.valueOf(TableAccessService.ROW_ORDER_KEY_DELIMITER)));
            pkValueToSeq.put(compositeKey, (long) result.rowNumber());
        }
        if (pkValueToSeq.isEmpty()) {
            return;
        }
        try {
            tableAccessService.recordRowOrder(ctx.table(), pkValueToSeq);
        } catch (Exception ignored) {
            // Non-critical — see method comment.
        }
    }
}
