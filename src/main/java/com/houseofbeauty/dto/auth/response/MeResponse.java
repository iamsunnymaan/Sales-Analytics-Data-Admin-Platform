package com.houseofbeauty.dto.auth.response;

import java.util.List;

// GET /api/auth/me's body — the current session's user plus their fully-resolved effective
// permission set (role grants ∪ per-user GRANT − per-user REVOKE, see AuthService#effectivePermissions).
// Exists so the seeded IAM_Login_Permissions/Role_Permissions data (AuthBootstrapSeeder) can
// actually be verified end to end by logging in as each demo account and hitting this endpoint,
// without needing a DB client — no controller enforces any of these keys yet, this just proves
// what a real check would see.
public record MeResponse(Long userId, String username, String fullName, List<String> roles, List<String> permissions) {
}
