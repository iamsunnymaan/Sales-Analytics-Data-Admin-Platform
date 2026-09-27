package com.houseofbeauty.dto.identity.response;

import java.time.LocalDateTime;
import java.util.List;

// Backs GET /api/identity/users and every create/update response — one row of RolesPage.js's
// "2. User Details" table (the old standalone Users page was folded into the Roles page). `status` is derived (not a raw column) since the table has two
// independent flags (Is_Active/Is_Locked) but the UI shows a single badge.
public record UserSummaryResponse(Long userId, String username, String fullName, String email,
                                   List<String> roles, String status, LocalDateTime createdAt,
                                   LocalDateTime lastLoginAt, LocalDateTime updatedAt) {
}
