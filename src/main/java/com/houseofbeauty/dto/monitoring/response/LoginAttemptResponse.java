package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

public record LoginAttemptResponse(Long auditId, String username, Long userId, boolean success,
                                    String ipAddress, LocalDateTime attemptedAt) {
}
