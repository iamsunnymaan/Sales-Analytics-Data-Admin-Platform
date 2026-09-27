package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

// Backs the Monitoring page's "5. Audit" section when Type=Download — one row of
// IAM_Login_Download_Audit.
public record DownloadAttemptResponse(Long downloadAuditId, String username, Long userId, String fileName,
                                       boolean success, String failureReason, String ipAddress,
                                       LocalDateTime attemptedAt) {
}
