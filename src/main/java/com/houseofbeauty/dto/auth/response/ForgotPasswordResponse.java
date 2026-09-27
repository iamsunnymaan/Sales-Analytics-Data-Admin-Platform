package com.houseofbeauty.dto.auth.response;

// POST /api/auth/forgot-password's ack. Deliberately generic (see AuthService.forgotPassword) so
// the response can't be used to enumerate which emails are registered. The actual reset link is
// never returned here — no email provider is wired up yet, so AuthService logs it server-side
// (same dev-only stand-in as SendOtpResponse) until real delivery is built.
public record ForgotPasswordResponse(boolean sent, String message) {
}
