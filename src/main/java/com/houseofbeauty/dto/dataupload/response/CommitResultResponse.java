package com.houseofbeauty.dto.dataupload.response;

import java.time.LocalDateTime;
import java.util.List;

/**
 * POST /{id}/commit's response. {@code message} is the session's error digest normally, but is
 * overridden to the capped-limit message (see {@code displayedInvalidRows}/{@code finalInvalidRow})
 * when {@code invalidRowLimitReached} is true — DataUploadPage.js reads {@code message} either way,
 * so this preserves the pre-DTO behavior where the capped display's own "message" entry was merged
 * into the response last and won.
 *
 * <p>{@code reconciliationStatus} is one of "VERIFIED"/"MISMATCH"/"SKIPPED" (see
 * {@code ImportCommitReconciler.Status}) — real post-commit proof that the rows the engine believes it
 * inserted are exactly the rows a fresh query finds, not just a row-count comparison.
 * {@code reconciliationDigest} is the SHA-256 this table's inserted primary-key values hashed to when
 * that check ran (null when SKIPPED).
 */
public record CommitResultResponse(String id, String originalFilename, String tableKey, String status,
                                    Integer totalRows, Integer validRows, Integer errorRows, Integer duplicateRows,
                                    Integer insertedRows, String message, LocalDateTime committedAt, long durationMs,
                                    String transactionStatus, List<ErrorDetail> errorDetails,
                                    boolean invalidRowLimitReached, List<RowResultResponse> displayedInvalidRows,
                                    RowResultResponse finalInvalidRow, String reconciliationStatus,
                                    String reconciliationDigest) {
}
