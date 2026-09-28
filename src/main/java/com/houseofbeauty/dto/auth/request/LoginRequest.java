package com.houseofbeauty.dto.auth.request;

public record LoginRequest(String username, String password, String otp, String mode) {
}
