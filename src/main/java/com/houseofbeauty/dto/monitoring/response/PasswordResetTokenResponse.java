package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

// Backs the Monitoring page's "Password Reset Tokens" section — one row of
// IAM_Login_Password_Reset_Tokens. Always empty today (see that entity's own header comment: no
// "forgot password" email flow exists yet to write to this table).
public record PasswordResetTokenResponse(Long tokenId, String username, Long userId, boolean used,
                                          LocalDateTime createdAt, LocalDateTime expiresAt) {
}
