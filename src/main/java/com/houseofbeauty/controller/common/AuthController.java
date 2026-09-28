package com.houseofbeauty.controller.common;

import com.houseofbeauty.dto.auth.request.ForgotPasswordRequest;
import com.houseofbeauty.dto.auth.request.LoginRequest;
import com.houseofbeauty.dto.auth.request.ResetPasswordRequest;
import com.houseofbeauty.dto.auth.request.SendOtpRequest;
import com.houseofbeauty.dto.auth.response.AuthResponse;
import com.houseofbeauty.dto.auth.response.ForgotPasswordResponse;
import com.houseofbeauty.dto.auth.response.MeResponse;
import com.houseofbeauty.dto.auth.response.ResetPasswordResponse;
import com.houseofbeauty.dto.auth.response.SendOtpResponse;
import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest request, HttpServletRequest servletRequest) {
        AuthResponse response = authService.login(
                request.username(),
                request.password(),
                request.otp(),
                request.mode(),
                servletRequest.getRemoteAddr());

        HttpSession existing = servletRequest.getSession(false);
        if (existing != null) {
            existing.invalidate();
        }
        HttpSession session = servletRequest.getSession(true);
        session.setAttribute(AuthenticatedUser.SESSION_ATTRIBUTE,
                new AuthenticatedUser(response.userId(), response.username(), response.fullName(), response.roles()));

        return response;
    }

    @PostMapping("/send-otp")
    public SendOtpResponse sendOtp(@RequestBody SendOtpRequest request) {
        authService.sendOtp(request.username());
        return new SendOtpResponse(true, "If this account exists, an OTP has been sent.");
    }

    @PostMapping("/forgot-password")
    public ForgotPasswordResponse forgotPassword(@RequestBody ForgotPasswordRequest request) {
        authService.forgotPassword(request.email());
        return new ForgotPasswordResponse(true, "If that email is registered, a reset link has been sent.");
    }

    @PostMapping("/reset-password")
    public ResetPasswordResponse resetPassword(@RequestBody ResetPasswordRequest request) {
        authService.resetPassword(request.token(), request.newPassword());
        return new ResetPasswordResponse(true, "Your password has been reset. You can now log in.");
    }

    @PostMapping("/logout")
    public Map<String, Boolean> logout(HttpServletRequest servletRequest) {
        HttpSession session = servletRequest.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        return Map.of("loggedOut", true);
    }

    @GetMapping("/me")
    public MeResponse me(HttpServletRequest servletRequest) {
        HttpSession session = servletRequest.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;
        if (authUser == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required. Please log in.");
        }
        return authService.me(authUser.getUserId());
    }
}
