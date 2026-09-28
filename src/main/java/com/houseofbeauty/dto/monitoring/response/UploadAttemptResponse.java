package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

public record UploadAttemptResponse(Long uploadAuditId, String username, Long userId, String fileName,
                                     String tableKey, boolean success, String failureReason, String ipAddress,
                                     LocalDateTime attemptedAt) {
}
