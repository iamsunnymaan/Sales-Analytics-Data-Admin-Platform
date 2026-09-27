package com.houseofbeauty.dto.auth.request;

// POST /api/auth/send-otp's body — triggered by LoginPage.html's "Send OTP" button.
public record SendOtpRequest(String username) {
}
