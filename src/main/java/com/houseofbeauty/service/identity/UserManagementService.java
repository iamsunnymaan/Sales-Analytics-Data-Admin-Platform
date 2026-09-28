package com.houseofbeauty.service.identity;

import com.houseofbeauty.dto.identity.request.CreateUserRequest;
import com.houseofbeauty.dto.identity.request.UpdateUserRequest;
import com.houseofbeauty.dto.identity.response.UserSummaryResponse;
import com.houseofbeauty.model.IamLoginRole;
import com.houseofbeauty.model.IamLoginUser;
import com.houseofbeauty.model.IamLoginUserRole;
import com.houseofbeauty.model.IamLoginUserRoleId;
import com.houseofbeauty.repository.IamLoginDownloadAuditRepository;
import com.houseofbeauty.repository.IamLoginLoginAuditRepository;
import com.houseofbeauty.repository.IamLoginOtpVerificationRepository;
import com.houseofbeauty.repository.IamLoginPasswordResetTokenRepository;
import com.houseofbeauty.repository.IamLoginRefreshTokenRepository;
import com.houseofbeauty.repository.IamLoginRoleRepository;
import com.houseofbeauty.repository.IamLoginUnauthorizedAuditRepository;
import com.houseofbeauty.repository.IamLoginUploadAuditRepository;
import com.houseofbeauty.repository.IamLoginUserPermissionRepository;
import com.houseofbeauty.repository.IamLoginUserRepository;
import com.houseofbeauty.repository.IamLoginUserRoleRepository;
import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.feature.FeatureManagementService;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class UserManagementService {

    private static final int MIN_PASSWORD_LENGTH = 8;

    private final IamLoginUserRepository userRepository;
    private final IamLoginRoleRepository roleRepository;
    private final IamLoginUserRoleRepository userRoleRepository;
    private final IamLoginUserPermissionRepository userPermissionRepository;
    private final IamLoginOtpVerificationRepository otpVerificationRepository;
    private final IamLoginRefreshTokenRepository refreshTokenRepository;
    private final IamLoginPasswordResetTokenRepository passwordResetTokenRepository;
    private final IamLoginLoginAuditRepository loginAuditRepository;
    private final IamLoginDownloadAuditRepository downloadAuditRepository;
    private final IamLoginUploadAuditRepository uploadAuditRepository;
    private final IamLoginUnauthorizedAuditRepository unauthorizedAuditRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthService authService;
    private final FeatureManagementService featureManagementService;

    public UserManagementService(IamLoginUserRepository userRepository,
                                  IamLoginRoleRepository roleRepository,
                                  IamLoginUserRoleRepository userRoleRepository,
                                  IamLoginUserPermissionRepository userPermissionRepository,
                                  IamLoginOtpVerificationRepository otpVerificationRepository,
                                  IamLoginRefreshTokenRepository refreshTokenRepository,
                                  IamLoginPasswordResetTokenRepository passwordResetTokenRepository,
                                  IamLoginLoginAuditRepository loginAuditRepository,
                                  IamLoginDownloadAuditRepository downloadAuditRepository,
                                  IamLoginUploadAuditRepository uploadAuditRepository,
                                  IamLoginUnauthorizedAuditRepository unauthorizedAuditRepository,
                                  PasswordEncoder passwordEncoder,
                                  AuthService authService,
                                  FeatureManagementService featureManagementService) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.userRoleRepository = userRoleRepository;
        this.userPermissionRepository = userPermissionRepository;
        this.otpVerificationRepository = otpVerificationRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.loginAuditRepository = loginAuditRepository;
        this.downloadAuditRepository = downloadAuditRepository;
        this.uploadAuditRepository = uploadAuditRepository;
        this.unauthorizedAuditRepository = unauthorizedAuditRepository;
        this.passwordEncoder = passwordEncoder;
        this.authService = authService;
        this.featureManagementService = featureManagementService;
    }

    public List<UserSummaryResponse> listUsers() {
        List<IamLoginUser> users = userRepository.findAll();
        Map<Integer, String> roleNamesById = roleRepository.findAll().stream()
                .collect(Collectors.toMap(IamLoginRole::getRoleId, IamLoginRole::getRoleName));

        return users.stream()
                .sorted(Comparator.comparing(IamLoginUser::getUsername, String.CASE_INSENSITIVE_ORDER))
                .map(user -> toSummary(user, roleNamesOf(user.getUserId(), roleNamesById)))
                .collect(Collectors.toList());
    }

    @Transactional
    public UserSummaryResponse createUser(CreateUserRequest request, boolean callerIsSuperAdmin) {
        String username = request.username() == null ? "" : request.username().trim();
        if (username.isBlank()) {
            throw new IllegalArgumentException("Username is required.");
        }
        validatePassword(request.password());
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username '" + username + "' already exists.");
        }
        if (!callerIsSuperAdmin) {
            rejectProtectedRoleAssignment(request.roleIds());
        }

        IamLoginUser user = new IamLoginUser();
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setFullName(blankToNull(request.fullName()));
        user.setEmail(blankToNull(request.email()));
        user.setActive(true);
        user.setLocked(false);
        user.setFailedLoginAttempts(0);
        user.setCreatedAt(LocalDateTime.now());
        user = userRepository.save(user);

        assignRoles(user.getUserId(), request.roleIds());

        return toSummary(user, roleNamesOf(request.roleIds()));
    }

    @Transactional
    public UserSummaryResponse updateUser(Long userId, UpdateUserRequest request, boolean callerIsSuperAdmin) {
        IamLoginUser user = getUserOrThrow(userId);
        if (!callerIsSuperAdmin) {
            rejectProtectedRoleChange(userId, request.roleIds());
        }

        String username = request.username() == null ? "" : request.username().trim();
        if (username.isBlank()) {
            throw new IllegalArgumentException("Username is required.");
        }
        if (!username.equalsIgnoreCase(user.getUsername()) && userRepository.existsByUsernameIgnoreCase(username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username '" + username + "' already exists.");
        }
        user.setUsername(username);

        user.setFullName(blankToNull(request.fullName()));
        user.setEmail(blankToNull(request.email()));
        if (request.active() != null) {
            user.setActive(request.active());
        }

        String newPassword = request.newPassword();
        if (newPassword != null && !newPassword.isBlank()) {
            validatePassword(newPassword);
            user.setPasswordHash(passwordEncoder.encode(newPassword));

            user.setFailedLoginAttempts(0);
            user.setLocked(false);
        }

        user.setUpdatedAt(LocalDateTime.now());
        user = userRepository.save(user);

        userRoleRepository.deleteByIdUserId(userId);
        assignRoles(userId, request.roleIds());
        authService.invalidatePermissionsCache(userId);
        featureManagementService.invalidateGrantedFeatureKeysCache(userId);

        return toSummary(user, roleNamesOf(request.roleIds()));
    }

    @Transactional
    public void deleteUser(Long userId) {
        IamLoginUser user = getUserOrThrow(userId);

        userRoleRepository.deleteByIdUserId(userId);
        userPermissionRepository.deleteByIdUserId(userId);
        otpVerificationRepository.deleteByUserId(userId);
        refreshTokenRepository.deleteByUserId(userId);
        passwordResetTokenRepository.deleteByUserId(userId);
        loginAuditRepository.detachUser(userId);
        downloadAuditRepository.detachUser(userId);
        uploadAuditRepository.detachUser(userId);
        unauthorizedAuditRepository.detachUser(userId);

        userRepository.delete(user);
        authService.invalidatePermissionsCache(userId);
        featureManagementService.invalidateGrantedFeatureKeysCache(userId);
    }

    private void rejectProtectedRoleAssignment(List<Integer> requestedRoleIds) {
        if (!protectedRoleIdsWithin(requestedRoleIds).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Assigning the SUPERADMIN/ADMIN role requires the Super Admin page.");
        }
    }

    private void rejectProtectedRoleChange(Long userId, List<Integer> requestedRoleIds) {
        Set<Integer> requestedProtected = protectedRoleIdsWithin(requestedRoleIds);
        List<Integer> currentRoleIds = userRoleRepository.findByIdUserId(userId).stream()
                .map(userRole -> userRole.getId().getRoleId())
                .collect(Collectors.toList());
        Set<Integer> currentProtected = protectedRoleIdsWithin(currentRoleIds);
        if (!requestedProtected.equals(currentProtected)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Assigning or revoking the SUPERADMIN/ADMIN role requires the Super Admin page.");
        }
    }

    private Set<Integer> protectedRoleIdsWithin(List<Integer> roleIds) {
        if (roleIds == null || roleIds.isEmpty()) {
            return Set.of();
        }
        return roleRepository.findAllById(roleIds).stream()
                .filter(role -> SystemRoles.isProtected(role.getRoleName()))
                .map(IamLoginRole::getRoleId)
                .collect(Collectors.toSet());
    }

    private void assignRoles(Long userId, List<Integer> roleIds) {
        if (roleIds == null) {
            return;
        }
        roleIds.stream().distinct().forEach(roleId ->
                userRoleRepository.save(new IamLoginUserRole(new IamLoginUserRoleId(userId, roleId))));
    }

    private IamLoginUser getUserOrThrow(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("User not found: " + userId));
    }

    private void validatePassword(String password) {
        if (password == null || password.length() < MIN_PASSWORD_LENGTH) {
            throw new IllegalArgumentException("Password must be at least " + MIN_PASSWORD_LENGTH + " characters.");
        }
    }

    private String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private List<String> roleNamesOf(Long userId, Map<Integer, String> roleNamesById) {
        return userRoleRepository.findByIdUserId(userId).stream()
                .map(userRole -> roleNamesById.get(userRole.getId().getRoleId()))
                .filter(Objects::nonNull)
                .sorted()
                .collect(Collectors.toList());
    }

    private List<String> roleNamesOf(List<Integer> roleIds) {
        if (roleIds == null || roleIds.isEmpty()) {
            return List.of();
        }
        Map<Integer, String> roleNamesById = roleRepository.findAllById(roleIds).stream()
                .collect(Collectors.toMap(IamLoginRole::getRoleId, IamLoginRole::getRoleName));
        return roleIds.stream()
                .map(roleNamesById::get)
                .filter(Objects::nonNull)
                .sorted()
                .collect(Collectors.toList());
    }

    private UserSummaryResponse toSummary(IamLoginUser user, List<String> roles) {
        String status = Boolean.TRUE.equals(user.getLocked())
                ? "Locked"
                : Boolean.TRUE.equals(user.getActive()) ? "Active" : "Inactive";
        return new UserSummaryResponse(user.getUserId(), user.getUsername(), user.getFullName(),
                user.getEmail(), roles, status, user.getCreatedAt(), user.getLastLoginAt(),
                user.getUpdatedAt());
    }
}
