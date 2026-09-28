package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

public record UnauthorizedAttemptResponse(Long unauthorizedAuditId, String username, Long userId, String resource,
                                           String reason, String ipAddress, LocalDateTime attemptedAt) {
}
