package com.houseofbeauty.controller.pages.monitoring;

import com.houseofbeauty.dto.monitoring.response.DownloadAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.LoginAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.OtpResponse;
import com.houseofbeauty.dto.monitoring.response.PasswordResetTokenResponse;
import com.houseofbeauty.dto.monitoring.response.UnauthorizedAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.UploadAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.UsageStatsResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.monitoring.MonitoringService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/monitoring")
@RequirePermission("page:monitoring")
public class MonitoringController {

    private final MonitoringService monitoringService;

    public MonitoringController(MonitoringService monitoringService) {
        this.monitoringService = monitoringService;
    }

    @GetMapping("/login-attempts")
    @RequirePermission("page:monitoring.login-attempts")
    public List<LoginAttemptResponse> getLoginAttempts() {
        return monitoringService.getLoginAttempts();
    }

    @GetMapping("/download-attempts")
    @RequirePermission("page:monitoring.download-attempts")
    public List<DownloadAttemptResponse> getDownloadAttempts() {
        return monitoringService.getDownloadAttempts();
    }

    @GetMapping("/upload-attempts")
    @RequirePermission("page:monitoring.upload-attempts")
    public List<UploadAttemptResponse> getUploadAttempts() {
        return monitoringService.getUploadAttempts();
    }

    @GetMapping("/unauthorized-attempts")
    @RequirePermission("page:monitoring.unauthorized-attempts")
    public List<UnauthorizedAttemptResponse> getUnauthorizedAttempts() {
        return monitoringService.getUnauthorizedAttempts();
    }

    @GetMapping("/password-reset-tokens")
    @RequirePermission("page:monitoring.password-reset-tokens")
    public List<PasswordResetTokenResponse> getPasswordResetTokens() {
        return monitoringService.getPasswordResetTokens();
    }

    @GetMapping("/otps")
    @RequirePermission("page:monitoring.otps")
    public List<OtpResponse> getOtps() {
        return monitoringService.getOtps();
    }

    @GetMapping("/usage-stats")
    @RequirePermission("page:monitoring.login-attempts")
    public UsageStatsResponse getUsageStats() {
        return monitoringService.getUsageStats();
    }
}
