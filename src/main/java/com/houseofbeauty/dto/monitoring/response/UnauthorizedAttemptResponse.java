package com.houseofbeauty.dto.monitoring.response;

import java.time.LocalDateTime;

// Backs the Monitoring page's "5. Audit" section when Type=Unauthorized Login — one row of
// IAM_Login_Unauthorized_Audit (a blocked request: a 403 from PermissionInterceptor or a
// permission-denied redirect from PageAccessInterceptor). resource is the page/API path that was
// attempted; reason is why it was blocked (backs Audit's own "Page"/"Result" columns).
public record UnauthorizedAttemptResponse(Long unauthorizedAuditId, String username, Long userId, String resource,
                                           String reason, String ipAddress, LocalDateTime attemptedAt) {
}
