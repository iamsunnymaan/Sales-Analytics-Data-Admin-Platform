package com.houseofbeauty.service.identity;

import com.houseofbeauty.dto.identity.request.CreateRoleRequest;
import com.houseofbeauty.dto.identity.request.UpdateRoleRequest;
import com.houseofbeauty.dto.identity.response.PermissionOptionResponse;
import com.houseofbeauty.dto.identity.response.RoleSummaryResponse;
import com.houseofbeauty.model.IamLoginPermission;
import com.houseofbeauty.model.IamLoginRole;
import com.houseofbeauty.model.IamLoginRolePermission;
import com.houseofbeauty.model.IamLoginRolePermissionId;
import com.houseofbeauty.repository.IamLoginPermissionRepository;
import com.houseofbeauty.repository.IamLoginRolePermissionRepository;
import com.houseofbeauty.repository.IamLoginRoleRepository;
import com.houseofbeauty.repository.IamLoginUserRoleRepository;
import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.feature.FeatureManagementService;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class RoleManagementService {

    private final IamLoginRoleRepository roleRepository;
    private final IamLoginPermissionRepository permissionRepository;
    private final IamLoginRolePermissionRepository rolePermissionRepository;
    private final IamLoginUserRoleRepository userRoleRepository;
    private final FeatureManagementService featureManagementService;
    private final AuthService authService;

    public RoleManagementService(IamLoginRoleRepository roleRepository,
                                  IamLoginPermissionRepository permissionRepository,
                                  IamLoginRolePermissionRepository rolePermissionRepository,
                                  IamLoginUserRoleRepository userRoleRepository,
                                  FeatureManagementService featureManagementService,
                                  AuthService authService) {
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.userRoleRepository = userRoleRepository;
        this.featureManagementService = featureManagementService;
        this.authService = authService;
    }

    public List<PermissionOptionResponse> listPermissions() {
        return permissionRepository.findAll().stream()

                .sorted(Comparator.comparing(IamLoginPermission::getPermissionId))
                .map(permission -> new PermissionOptionResponse(permission.getPermissionId(),
                        permission.getPermissionKey(), permission.getLabel(), permission.getDescription(),
                        permission.getPermissionType(), permission.getParentPermissionId()))
                .collect(Collectors.toList());
    }

    public List<RoleSummaryResponse> listRoleSummaries() {
        List<IamLoginRole> roles = roleRepository.findAll();

        return roles.stream()
                .sorted(Comparator.comparing(IamLoginRole::getRoleName, String.CASE_INSENSITIVE_ORDER))
                .map(role -> toSummary(role, permissionIdsOf(role.getRoleId()),
                        featureManagementService.getGrantedFeatureIdsForRole(role.getRoleId())))
                .collect(Collectors.toList());
    }

    @Transactional
    public RoleSummaryResponse createRole(CreateRoleRequest request, boolean callerIsSuperAdmin) {
        String roleName = request.roleName() == null ? "" : request.roleName().trim();
        if (roleName.isBlank()) {
            throw new IllegalArgumentException("Role name is required.");
        }
        if (!callerIsSuperAdmin && SystemRoles.isProtected(roleName)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "The '" + roleName + "' role can only be managed from the Super Admin page.");
        }
        if (roleRepository.findByRoleNameIgnoreCase(roleName).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Role '" + roleName + "' already exists.");
        }
        if (!callerIsSuperAdmin) {
            rejectSuperAdminPermissions(request.permissionIds());
        }

        IamLoginRole role = new IamLoginRole();
        role.setRoleName(roleName);
        role.setDescription(blankToNull(request.description()));
        role = roleRepository.save(role);

        assignPermissions(role.getRoleId(), request.permissionIds());
        featureManagementService.replaceRoleFeatures(role.getRoleId(), request.featureIds());

        return toSummary(role, permissionIdsOf(role.getRoleId()),
                featureManagementService.getGrantedFeatureIdsForRole(role.getRoleId()));
    }

    @Transactional
    public RoleSummaryResponse updateRole(Integer roleId, UpdateRoleRequest request, boolean callerIsSuperAdmin) {
        IamLoginRole role = getRoleOrThrow(roleId);
        if (!callerIsSuperAdmin && SystemRoles.isProtected(role.getRoleName())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "The '" + role.getRoleName() + "' role can only be managed from the Super Admin page.");
        }

        String roleName = request.roleName() == null ? "" : request.roleName().trim();
        if (roleName.isBlank()) {
            throw new IllegalArgumentException("Role name is required.");
        }
        if (!callerIsSuperAdmin && SystemRoles.isProtected(roleName)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "The '" + roleName + "' role can only be managed from the Super Admin page.");
        }
        roleRepository.findByRoleNameIgnoreCase(roleName)
                .filter(existing -> !existing.getRoleId().equals(roleId))
                .ifPresent(existing -> {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Role '" + roleName + "' already exists.");
                });
        if (!callerIsSuperAdmin) {
            rejectSuperAdminPermissions(request.permissionIds());
        }

        role.setRoleName(roleName);
        role.setDescription(blankToNull(request.description()));
        role = roleRepository.save(role);

        rolePermissionRepository.deleteByIdRoleId(roleId);
        assignPermissions(roleId, request.permissionIds());
        featureManagementService.replaceRoleFeatures(roleId, request.featureIds());
        authService.invalidateAllPermissionsCache();

        return toSummary(role, permissionIdsOf(roleId),
                featureManagementService.getGrantedFeatureIdsForRole(roleId));
    }

    @Transactional
    public void deleteRole(Integer roleId, boolean callerIsSuperAdmin) {
        IamLoginRole role = getRoleOrThrow(roleId);
        if (!callerIsSuperAdmin && SystemRoles.isProtected(role.getRoleName())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "The '" + role.getRoleName() + "' role can only be managed from the Super Admin page.");
        }

        rolePermissionRepository.deleteByIdRoleId(roleId);
        featureManagementService.deleteRoleFeatures(roleId);
        userRoleRepository.deleteByIdRoleId(roleId);

        roleRepository.delete(role);
        authService.invalidateAllPermissionsCache();
    }

    private void rejectSuperAdminPermissions(List<Integer> permissionIds) {
        if (permissionIds == null || permissionIds.isEmpty()) {
            return;
        }
        boolean grantsSuperAdmin = permissionRepository.findAllById(permissionIds).stream()
                .anyMatch(permission -> permission.getPermissionKey() != null
                        && permission.getPermissionKey().startsWith(SystemRoles.SUPERADMIN_PERMISSION_PREFIX));
        if (grantsSuperAdmin) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only the Super Admin page can grant Super Admin permissions.");
        }
    }

    private void assignPermissions(Integer roleId, List<Integer> permissionIds) {
        if (permissionIds == null) {
            return;
        }
        permissionIds.stream().distinct().forEach(permissionId ->
                rolePermissionRepository.save(new IamLoginRolePermission(new IamLoginRolePermissionId(roleId, permissionId))));
    }

    private IamLoginRole getRoleOrThrow(Integer roleId) {
        return roleRepository.findById(roleId)
                .orElseThrow(() -> new EntityNotFoundException("Role not found: " + roleId));
    }

    private String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private List<Integer> permissionIdsOf(Integer roleId) {
        return rolePermissionRepository.findByIdRoleId(roleId).stream()
                .map(rolePermission -> rolePermission.getId().getPermissionId())
                .collect(Collectors.toList());
    }

    private RoleSummaryResponse toSummary(IamLoginRole role, List<Integer> permissionIds, List<Integer> featureIds) {
        List<Integer> ids = permissionIds == null ? List.of() : permissionIds;
        Map<Integer, String> permissionLabelsById = permissionRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(IamLoginPermission::getPermissionId,
                        permission -> permission.getLabel() != null ? permission.getLabel() : permission.getPermissionKey()));
        List<String> labels = ids.stream()
                .map(permissionLabelsById::get)
                .filter(Objects::nonNull)
                .sorted()
                .collect(Collectors.toList());

        long userCount = userRoleRepository.countByIdRoleId(role.getRoleId());
        return new RoleSummaryResponse(role.getRoleId(), role.getRoleName(), role.getDescription(),
                labels, ids, featureIds == null ? List.of() : featureIds, userCount);
    }
}
