package com.houseofbeauty.dto.auth.request;

public record ResetPasswordRequest(String token, String newPassword) {
}
