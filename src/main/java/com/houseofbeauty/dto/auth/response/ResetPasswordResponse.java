package com.houseofbeauty.dto.auth.response;

// POST /api/auth/reset-password's ack.
public record ResetPasswordResponse(boolean reset, String message) {
}
