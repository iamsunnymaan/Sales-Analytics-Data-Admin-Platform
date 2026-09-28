package com.houseofbeauty.dto.dataupload.response;

import java.time.LocalDateTime;
import java.util.List;

public record CommitResultResponse(String id, String originalFilename, String tableKey, String status,
                                    Integer totalRows, Integer validRows, Integer errorRows, Integer duplicateRows,
                                    Integer insertedRows, String message, LocalDateTime committedAt, long durationMs,
                                    String transactionStatus, List<ErrorDetail> errorDetails,
                                    boolean invalidRowLimitReached, List<RowResultResponse> displayedInvalidRows,
                                    RowResultResponse finalInvalidRow, String reconciliationStatus,
                                    String reconciliationDigest) {
}
