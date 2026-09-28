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


                if (state.shouldStop()) {
                    status.setRollbackOnly();
                }
                return null;
            });
        } catch (Exception criticalEx) {

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

        if (!aborted) {
            tableAccessService.recordLastImport(ctx.table());
        }


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

        }
    }
}
