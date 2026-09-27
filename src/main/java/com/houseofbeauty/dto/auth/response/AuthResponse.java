package com.houseofbeauty.dto.auth.response;

import java.util.List;

// POST /api/auth/login's success body — cached by LoginPage.js in sessionStorage after a
// successful sign-in. No token yet (see IamLoginRefreshToken's header comment); page-level/
// section-level enforcement based on `roles` is a follow-up, not wired to any page guard yet.
public record AuthResponse(Long userId, String username, String fullName, List<String> roles) {
}
