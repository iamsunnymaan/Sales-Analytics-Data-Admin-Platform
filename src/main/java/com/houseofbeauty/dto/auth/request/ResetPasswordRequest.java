package com.houseofbeauty.dto.auth.request;

// POST /api/auth/reset-password's body — triggered by ResetPasswordPage.html, which reads
// `token` from its own URL's ?token= query param (the value emailed/logged by forgot-password).
public record ResetPasswordRequest(String token, String newPassword) {
}
