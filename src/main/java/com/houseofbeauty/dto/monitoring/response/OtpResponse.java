package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

public record OtpResponse(Long otpId, String username, Long userId, String purpose, boolean used,
                           LocalDateTime createdAt, LocalDateTime expiresAt) {
}
