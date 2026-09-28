package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

public record PasswordResetTokenResponse(Long tokenId, String username, Long userId, boolean used,
                                          LocalDateTime createdAt, LocalDateTime expiresAt) {
}
