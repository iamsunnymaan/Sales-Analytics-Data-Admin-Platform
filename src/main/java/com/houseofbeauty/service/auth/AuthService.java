package com.houseofbeauty.service.auth;

import com.houseofbeauty.dto.auth.response.AuthResponse;
import com.houseofbeauty.dto.auth.response.MeResponse;
import com.houseofbeauty.model.IamLoginLoginAudit;
import com.houseofbeauty.model.IamLoginOtpVerification;
import com.houseofbeauty.model.IamLoginPasswordResetToken;
import com.houseofbeauty.model.IamLoginPermission;
import com.houseofbeauty.model.IamLoginRole;
import com.houseofbeauty.model.IamLoginRolePermission;
import com.houseofbeauty.model.IamLoginUser;
import com.houseofbeauty.model.IamLoginUserPermission;
import com.houseofbeauty.model.IamLoginUserRole;
import com.houseofbeauty.repository.IamLoginLoginAuditRepository;
import com.houseofbeauty.repository.IamLoginOtpVerificationRepository;
import com.houseofbeauty.repository.IamLoginPasswordResetTokenRepository;
import com.houseofbeauty.repository.IamLoginPermissionRepository;
import com.houseofbeauty.repository.IamLoginRolePermissionRepository;
import com.houseofbeauty.repository.IamLoginRoleRepository;
import com.houseofbeauty.repository.IamLoginUserPermissionRepository;
import com.houseofbeauty.repository.IamLoginUserRepository;
import com.houseofbeauty.repository.IamLoginUserRoleRepository;
import com.houseofbeauty.service.identity.SystemRoles;
import com.houseofbeauty.util.TtlCache;
import jakarta.persistence.EntityNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final int OTP_LENGTH_DIGITS = 6;
    private static final long OTP_VALIDITY_MINUTES = 5;
    private static final String OTP_PURPOSE_LOGIN = "LOGIN";
    private static final long PASSWORD_RESET_VALIDITY_MINUTES = 30;
    private static final int MIN_PASSWORD_LENGTH = 8;

    private static final long PERMISSIONS_CACHE_TTL_MILLIS = 30_000;
    private final TtlCache<Long, Set<String>> permissionsCache = new TtlCache<>(PERMISSIONS_CACHE_TTL_MILLIS);

    private final IamLoginUserRepository userRepository;
    private final IamLoginRoleRepository roleRepository;
    private final IamLoginUserRoleRepository userRoleRepository;
    private final IamLoginPermissionRepository permissionRepository;
    private final IamLoginRolePermissionRepository rolePermissionRepository;
    private final IamLoginUserPermissionRepository userPermissionRepository;
    private final IamLoginOtpVerificationRepository otpVerificationRepository;
    private final IamLoginLoginAuditRepository loginAuditRepository;
    private final IamLoginPasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final SecureRandom secureRandom = new SecureRandom();

    public AuthService(IamLoginUserRepository userRepository,
                        IamLoginRoleRepository roleRepository,
                        IamLoginUserRoleRepository userRoleRepository,
                        IamLoginPermissionRepository permissionRepository,
                        IamLoginRolePermissionRepository rolePermissionRepository,
                        IamLoginUserPermissionRepository userPermissionRepository,
                        IamLoginOtpVerificationRepository otpVerificationRepository,
                        IamLoginLoginAuditRepository loginAuditRepository,
                        IamLoginPasswordResetTokenRepository passwordResetTokenRepository,
                        PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.userRoleRepository = userRoleRepository;
        this.permissionRepository = permissionRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.userPermissionRepository = userPermissionRepository;
        this.otpVerificationRepository = otpVerificationRepository;
        this.loginAuditRepository = loginAuditRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional(noRollbackFor = ResponseStatusException.class)
    public AuthResponse login(String username, String password, String otp, String mode, String ipAddress) {
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("User ID is required.");
        }
        boolean otpMode = "otp".equalsIgnoreCase(mode);
        if (!otpMode && !"password".equalsIgnoreCase(mode)) {
            throw new IllegalArgumentException("Invalid login mode: " + mode);
        }

        Optional<IamLoginUser> userOpt = userRepository.findByUsernameIgnoreCase(username.trim());
        if (userOpt.isEmpty()) {
            recordAttempt(null, username, false, ipAddress);
            throw unauthorized();
        }

        IamLoginUser user = userOpt.get();

        if (Boolean.TRUE.equals(user.getLocked())) {
            recordAttempt(user.getUserId(), username, false, ipAddress);
            throw new ResponseStatusException(HttpStatus.LOCKED,
                    "This account is locked. Contact your administrator.");
        }
        if (!Boolean.TRUE.equals(user.getActive())) {
            recordAttempt(user.getUserId(), username, false, ipAddress);
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "This account is inactive. Contact your administrator.");
        }

        boolean credentialOk = otpMode
                ? verifyOtp(user, otp)
                : password != null && !password.isBlank() && passwordEncoder.matches(password, user.getPasswordHash());

        if (!credentialOk) {
            registerFailedAttempt(user);
            recordAttempt(user.getUserId(), username, false, ipAddress);
            throw unauthorized(otpMode ? "Invalid or expired OTP." : "Invalid User ID or password.");
        }

        user.setFailedLoginAttempts(0);
        user.setLastLoginAt(LocalDateTime.now());
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        recordAttempt(user.getUserId(), username, true, ipAddress);

        return new AuthResponse(user.getUserId(), user.getUsername(), user.getFullName(), rolesOf(user.getUserId()));
    }

    @Transactional
    public void sendOtp(String username) {
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("User ID is required.");
        }

        Optional<IamLoginUser> userOpt = userRepository.findByUsernameIgnoreCase(username.trim());
        if (userOpt.isEmpty()) {
            return;
        }
        IamLoginUser user = userOpt.get();
        if (Boolean.TRUE.equals(user.getLocked()) || !Boolean.TRUE.equals(user.getActive())) {
            return;
        }

        String rawOtp = generateOtp();

        IamLoginOtpVerification verification = new IamLoginOtpVerification();
        verification.setUserId(user.getUserId());
        verification.setOtpCodeHash(passwordEncoder.encode(rawOtp));
        verification.setPurpose(OTP_PURPOSE_LOGIN);
        verification.setExpiresAt(LocalDateTime.now().plusMinutes(OTP_VALIDITY_MINUTES));
        verification.setUsed(false);
        verification.setCreatedAt(LocalDateTime.now());
        otpVerificationRepository.save(verification);

        log.info("[DEV-ONLY, remove once real OTP delivery exists] OTP for '{}': {} (expires in {} min)",
                user.getUsername(), rawOtp, OTP_VALIDITY_MINUTES);
    }

    @Transactional
    public void forgotPassword(String email) {
        if (email == null || email.isBlank()) {
            throw new IllegalArgumentException("Email is required.");
        }

        Optional<IamLoginUser> userOpt = userRepository.findByEmailIgnoreCase(email.trim());
        if (userOpt.isEmpty()) {
            return;
        }
        IamLoginUser user = userOpt.get();
        if (Boolean.TRUE.equals(user.getLocked()) || !Boolean.TRUE.equals(user.getActive())) {
            return;
        }

        String rawToken = generateResetToken();

        IamLoginPasswordResetToken resetToken = new IamLoginPasswordResetToken();
        resetToken.setUserId(user.getUserId());
        resetToken.setTokenHash(hashToken(rawToken));
        resetToken.setExpiresAt(LocalDateTime.now().plusMinutes(PASSWORD_RESET_VALIDITY_MINUTES));
        resetToken.setUsedAt(null);
        resetToken.setCreatedAt(LocalDateTime.now());
        passwordResetTokenRepository.save(resetToken);

        log.info("[DEV-ONLY, remove once real email delivery exists] Password reset link for '{}': " +
                        "/pages/ResetPasswordPage/ResetPasswordPage.html?token={} (expires in {} min)",
                user.getUsername(), rawToken, PASSWORD_RESET_VALIDITY_MINUTES);
    }

    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        if (rawToken == null || rawToken.isBlank()) {
            throw invalidResetLink();
        }
        if (newPassword == null || newPassword.length() < MIN_PASSWORD_LENGTH) {
            throw new IllegalArgumentException("Password must be at least " + MIN_PASSWORD_LENGTH + " characters.");
        }

        IamLoginPasswordResetToken resetToken = passwordResetTokenRepository.findByTokenHash(hashToken(rawToken))
                .orElseThrow(AuthService::invalidResetLink);
        if (resetToken.getUsedAt() != null || resetToken.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw invalidResetLink();
        }

        IamLoginUser user = userRepository.findById(resetToken.getUserId())
                .orElseThrow(AuthService::invalidResetLink);

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setFailedLoginAttempts(0);
        user.setLocked(false);
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);

        resetToken.setUsedAt(LocalDateTime.now());
        passwordResetTokenRepository.save(resetToken);
    }

    private String generateResetToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hashToken(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static ResponseStatusException invalidResetLink() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "This reset link is invalid or has expired. Please request a new one.");
    }

    private boolean verifyOtp(IamLoginUser user, String rawOtp) {
        if (rawOtp == null || rawOtp.isBlank()) {
            return false;
        }
        Optional<IamLoginOtpVerification> otpOpt = otpVerificationRepository
                .findFirstByUserIdAndPurposeAndUsedFalseOrderByCreatedAtDesc(user.getUserId(), OTP_PURPOSE_LOGIN);
        if (otpOpt.isEmpty()) {
            return false;
        }
        IamLoginOtpVerification otp = otpOpt.get();
        if (otp.getExpiresAt().isBefore(LocalDateTime.now())) {
            return false;
        }
        if (!passwordEncoder.matches(rawOtp.trim(), otp.getOtpCodeHash())) {
            return false;
        }
        otp.setUsed(true);
        otpVerificationRepository.save(otp);
        return true;
    }

    private void registerFailedAttempt(IamLoginUser user) {
        int attempts = (user.getFailedLoginAttempts() == null ? 0 : user.getFailedLoginAttempts()) + 1;
        user.setFailedLoginAttempts(attempts);
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            user.setLocked(true);
        }
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
    }

    private void recordAttempt(Long userId, String usernameAttempted, boolean success, String ipAddress) {
        IamLoginLoginAudit audit = new IamLoginLoginAudit();
        audit.setUserId(userId);
        audit.setUsernameAttempted(usernameAttempted);
        audit.setSuccess(success);
        audit.setIpAddress(ipAddress);
        audit.setAttemptedAt(LocalDateTime.now());
        loginAuditRepository.save(audit);
    }

    public MeResponse me(Long userId) {
        IamLoginUser user = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("User not found: " + userId));
        List<Integer> roleIds = roleIdsOf(userId);
        List<String> roles = roleNamesOf(roleIds);
        List<String> permissions = effectivePermissions(userId, roleIds);
        return new MeResponse(user.getUserId(), user.getUsername(), user.getFullName(), roles, permissions);
    }

    public Set<String> effectivePermissions(Long userId) {
        return permissionsCache.get(userId,
                id -> Collections.unmodifiableSet(new LinkedHashSet<>(effectivePermissions(id, roleIdsOf(id)))));
    }

    public void invalidateAllPermissionsCache() {
        permissionsCache.evictAll();
    }

    public void invalidatePermissionsCache(Long userId) {
        permissionsCache.evict(userId);
    }

    public boolean isSuperAdmin(Long userId) {
        return roleNamesOf(roleIdsOf(userId)).stream()
                .anyMatch(name -> SystemRoles.SUPERADMIN_ROLE_NAME.equalsIgnoreCase(name));
    }

    private List<Integer> roleIdsOf(Long userId) {
        return userRoleRepository.findByIdUserId(userId).stream()
                .map(IamLoginUserRole::getId)
                .map(id -> id.getRoleId())
                .collect(Collectors.toList());
    }

    private List<String> rolesOf(Long userId) {
        return roleNamesOf(roleIdsOf(userId));
    }

    private List<String> roleNamesOf(List<Integer> roleIds) {
        if (roleIds.isEmpty()) {
            return List.of();
        }
        return roleRepository.findAllById(roleIds).stream()
                .map(IamLoginRole::getRoleName)
                .collect(Collectors.toList());
    }

    private List<String> effectivePermissions(Long userId, List<Integer> roleIds) {
        Set<Integer> permissionIds = new LinkedHashSet<>();
        if (!roleIds.isEmpty()) {
            rolePermissionRepository.findByIdRoleIdIn(roleIds)
                    .forEach(rp -> permissionIds.add(rp.getId().getPermissionId()));
        }

        for (IamLoginUserPermission override : userPermissionRepository.findByIdUserId(userId)) {
            Integer permissionId = override.getId().getPermissionId();
            if ("REVOKE".equalsIgnoreCase(override.getEffect())) {
                permissionIds.remove(permissionId);
            } else {
                permissionIds.add(permissionId);
            }
        }

        if (permissionIds.isEmpty()) {
            return List.of();
        }
        return permissionRepository.findAllById(permissionIds).stream()
                .map(IamLoginPermission::getPermissionKey)
                .sorted()
                .collect(Collectors.toList());
    }

    private String generateOtp() {
        int bound = (int) Math.pow(10, OTP_LENGTH_DIGITS);
        int value = secureRandom.nextInt(bound);
        return String.format("%0" + OTP_LENGTH_DIGITS + "d", value);
    }

    private static ResponseStatusException unauthorized() {
        return unauthorized("Invalid User ID or password.");
    }

    private static ResponseStatusException unauthorized(String message) {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, message);
    }
}
