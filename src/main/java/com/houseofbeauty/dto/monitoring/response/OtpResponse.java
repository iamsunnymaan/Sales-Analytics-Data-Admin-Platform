package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

// Backs the Monitoring page's "Recent OTPs" section — one row of IAM_Login_Otp_Verifications.
public record OtpResponse(Long otpId, String username, Long userId, String purpose, boolean used,
                           LocalDateTime createdAt, LocalDateTime expiresAt) {
}
