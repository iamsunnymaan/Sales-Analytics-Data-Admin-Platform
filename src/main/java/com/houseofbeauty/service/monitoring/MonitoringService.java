package com.houseofbeauty.service.monitoring;

import com.houseofbeauty.dto.monitoring.response.DownloadAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.LoginAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.OtpResponse;
import com.houseofbeauty.dto.monitoring.response.PasswordResetTokenResponse;
import com.houseofbeauty.dto.monitoring.response.UnauthorizedAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.UploadAttemptResponse;
import com.houseofbeauty.dto.monitoring.response.UsageStatsResponse;
import com.houseofbeauty.model.IamLoginLoginAudit;
import com.houseofbeauty.model.IamLoginOtpVerification;
import com.houseofbeauty.model.IamLoginPasswordResetToken;
import com.houseofbeauty.model.IamLoginUser;
import com.houseofbeauty.repository.IamLoginDownloadAuditRepository;
import com.houseofbeauty.repository.IamLoginLoginAuditRepository;
import com.houseofbeauty.repository.IamLoginOtpVerificationRepository;
import com.houseofbeauty.repository.IamLoginPasswordResetTokenRepository;
import com.houseofbeauty.repository.IamLoginUnauthorizedAuditRepository;
import com.houseofbeauty.repository.IamLoginUploadAuditRepository;
import com.houseofbeauty.repository.IamLoginUserRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Stream;
import java.util.stream.Collectors;

@Service
public class MonitoringService {

    private final IamLoginLoginAuditRepository loginAuditRepository;
    private final IamLoginDownloadAuditRepository downloadAuditRepository;
    private final IamLoginUploadAuditRepository uploadAuditRepository;
    private final IamLoginUnauthorizedAuditRepository unauthorizedAuditRepository;
    private final IamLoginPasswordResetTokenRepository passwordResetTokenRepository;
    private final IamLoginOtpVerificationRepository otpVerificationRepository;
    private final IamLoginUserRepository userRepository;

    public MonitoringService(IamLoginLoginAuditRepository loginAuditRepository,
                              IamLoginDownloadAuditRepository downloadAuditRepository,
                              IamLoginUploadAuditRepository uploadAuditRepository,
                              IamLoginUnauthorizedAuditRepository unauthorizedAuditRepository,
                              IamLoginPasswordResetTokenRepository passwordResetTokenRepository,
                              IamLoginOtpVerificationRepository otpVerificationRepository,
                              IamLoginUserRepository userRepository) {
        this.loginAuditRepository = loginAuditRepository;
        this.downloadAuditRepository = downloadAuditRepository;
        this.uploadAuditRepository = uploadAuditRepository;
        this.unauthorizedAuditRepository = unauthorizedAuditRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.otpVerificationRepository = otpVerificationRepository;
        this.userRepository = userRepository;
    }

    public List<LoginAttemptResponse> getLoginAttempts() {
        return loginAuditRepository.findTop300ByOrderByAttemptedAtDesc().stream()
                .map(a -> new LoginAttemptResponse(a.getAuditId(), a.getUsernameAttempted(), a.getUserId(),
                        Boolean.TRUE.equals(a.getSuccess()), a.getIpAddress(), a.getAttemptedAt()))
                .collect(Collectors.toList());
    }

    public List<DownloadAttemptResponse> getDownloadAttempts() {
        return downloadAuditRepository.findTop300ByOrderByAttemptedAtDesc().stream()
                .map(a -> new DownloadAttemptResponse(a.getDownloadAuditId(), a.getUsernameAttempted(), a.getUserId(),
                        a.getFileName(), Boolean.TRUE.equals(a.getSuccess()), a.getFailureReason(),
                        a.getIpAddress(), a.getAttemptedAt()))
                .collect(Collectors.toList());
    }

    public List<UploadAttemptResponse> getUploadAttempts() {
        return uploadAuditRepository.findTop300ByOrderByAttemptedAtDesc().stream()
                .map(a -> new UploadAttemptResponse(a.getUploadAuditId(), a.getUsernameAttempted(), a.getUserId(),
                        a.getFileName(), a.getTableKey(), Boolean.TRUE.equals(a.getSuccess()), a.getFailureReason(),
                        a.getIpAddress(), a.getAttemptedAt()))
                .collect(Collectors.toList());
    }

    public List<UnauthorizedAttemptResponse> getUnauthorizedAttempts() {
        return unauthorizedAuditRepository.findTop300ByOrderByAttemptedAtDesc().stream()
                .map(a -> new UnauthorizedAttemptResponse(a.getUnauthorizedAuditId(), a.getUsernameAttempted(),
                        a.getUserId(), a.getResource(), a.getReason(), a.getIpAddress(), a.getAttemptedAt()))
                .collect(Collectors.toList());
    }

    public List<PasswordResetTokenResponse> getPasswordResetTokens() {
        List<IamLoginPasswordResetToken> tokens = passwordResetTokenRepository.findTop300ByOrderByCreatedAtDesc();
        Map<Long, String> usernamesById = usernamesById(tokens.stream().map(IamLoginPasswordResetToken::getUserId));
        return tokens.stream()
                .map(t -> new PasswordResetTokenResponse(t.getTokenId(), usernamesById.get(t.getUserId()), t.getUserId(),
                        t.getUsedAt() != null, t.getCreatedAt(), t.getExpiresAt()))
                .collect(Collectors.toList());
    }

    public List<OtpResponse> getOtps() {
        List<IamLoginOtpVerification> otps = otpVerificationRepository.findTop300ByOrderByCreatedAtDesc();
        Map<Long, String> usernamesById = usernamesById(otps.stream().map(IamLoginOtpVerification::getUserId));
        return otps.stream()
                .map(o -> new OtpResponse(o.getOtpId(), usernamesById.get(o.getUserId()), o.getUserId(),
                        o.getPurpose(), Boolean.TRUE.equals(o.getUsed()), o.getCreatedAt(), o.getExpiresAt()))
                .collect(Collectors.toList());
    }

    public UsageStatsResponse getUsageStats() {
        LocalDateTime since = LocalDateTime.now().minusDays(30);
        List<IamLoginLoginAudit> recentSuccesses = loginAuditRepository.findBySuccessTrueAndAttemptedAtAfter(since);

        long[] hourCounts = new long[24];
        Map<String, Long> byUsername = new HashMap<>();
        for (IamLoginLoginAudit audit : recentSuccesses) {
            hourCounts[audit.getAttemptedAt().getHour()]++;
            byUsername.merge(audit.getUsernameAttempted(), 1L, Long::sum);
        }

        List<UsageStatsResponse.HourlyCount> byHour = new ArrayList<>(24);
        for (int hour = 0; hour < 24; hour++) {
            byHour.add(new UsageStatsResponse.HourlyCount(hour, hourCounts[hour]));
        }

        List<UsageStatsResponse.UserCount> byUser = byUsername.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(15)
                .map(e -> new UsageStatsResponse.UserCount(e.getKey(), e.getValue()))
                .collect(Collectors.toList());

        return new UsageStatsResponse(byHour, byUser);
    }

    private Map<Long, String> usernamesById(Stream<Long> userIds) {
        Set<Long> ids = userIds.filter(Objects::nonNull).collect(Collectors.toCollection(HashSet::new));
        if (ids.isEmpty()) {
            return Map.of();
        }
        return userRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(IamLoginUser::getUserId, IamLoginUser::getUsername));
    }
}
