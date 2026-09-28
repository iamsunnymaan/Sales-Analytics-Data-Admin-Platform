package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

public record DownloadAttemptResponse(Long downloadAuditId, String username, Long userId, String fileName,
                                       boolean success, String failureReason, String ipAddress,
                                       LocalDateTime attemptedAt) {
}
