package com.houseofbeauty.dto.auth.request;

// POST /api/auth/login's body. mode is "password" or "otp" (matches LoginPage.html's Password/OTP
// mode toggle) — only the matching credential field needs to be non-blank; AuthService validates
// that, not bean-validation annotations, since which field is required depends on mode.
public record LoginRequest(String username, String password, String otp, String mode) {
}
