package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

// Backs the Monitoring page's "5. Audit" section when Type=Login — one row of
// IAM_Login_Login_Audit. username is the raw Username_Attempted column (survives the account being
// deleted, or never having existed at all for a brute-force attempt against a made-up name); userId
// is the resolved account only when one still exists.
public record LoginAttemptResponse(Long auditId, String username, Long userId, boolean success,
                                    String ipAddress, LocalDateTime attemptedAt) {
}
