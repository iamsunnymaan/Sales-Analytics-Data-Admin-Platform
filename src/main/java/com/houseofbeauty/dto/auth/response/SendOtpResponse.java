package com.houseofbeauty.dto.auth.response;

// POST /api/auth/send-otp's ack. The actual code is never returned here — no email/SMS provider
// is wired up yet, so AuthService logs it server-side (see its own header comment) until real
// delivery is built.
public record SendOtpResponse(boolean sent, String message) {
}
