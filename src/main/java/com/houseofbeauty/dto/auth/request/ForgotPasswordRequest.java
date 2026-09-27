package com.houseofbeauty.dto.auth.request;

// POST /api/auth/forgot-password's body — triggered by LoginPage.html's "Forgot password?" link.
public record ForgotPasswordRequest(String email) {
}
