package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

// Backs the Monitoring page's "5. Audit" section when Type=Upload — one row of
// IAM_Login_Upload_Audit. tableKey is the real Table_Key column (which import table the upload
// targeted, e.g. "primary_sales") — backs Audit's own "Table" column.
public record UploadAttemptResponse(Long uploadAuditId, String username, Long userId, String fileName,
                                     String tableKey, boolean success, String failureReason, String ipAddress,
                                     LocalDateTime attemptedAt) {
}
