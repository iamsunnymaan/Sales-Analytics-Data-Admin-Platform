package com.houseofbeauty.controller.pages.identity;

import com.houseofbeauty.dto.identity.request.CreateRoleRequest;
import com.houseofbeauty.dto.identity.request.UpdateRoleRequest;
import com.houseofbeauty.dto.identity.response.PermissionOptionResponse;
import com.houseofbeauty.dto.identity.response.RoleSummaryResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import com.houseofbeauty.service.identity.RoleManagementService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Role management (New Role/Edit Role/Delete, the "Role and Details" table, the Permission/Feature
// picker) moved to the IAM page per explicit request — RolesPage.js no longer has any of it,
// IAMPage.js is now the only frontend calling the mutating endpoints below. The class-level
// permission still accepts EITHER "page:roles" or "page:iam" — /permissions and /roles/details are
// read-only endpoints also called from the Roles & Users page (its own New/Edit User modal's Roles
// checkbox list — see UsersController's own header comment), which needs them even for a session
// that holds page:roles.user-details but nothing under Role and Details.
@RestController
@RequestMapping("/api/identity")
@RequirePermission({"page:roles", "page:iam"})
public class RolesController {

    private final RoleManagementService roleManagementService;
    private final AuthService authService;

    public RolesController(RoleManagementService roleManagementService, AuthService authService) {
        this.roleManagementService = roleManagementService;
        this.authService = authService;
    }

    // /permissions and /roles/details stay behind only the class-level "page:roles"/"page:iam"
    // check — see this class's own header comment. The mutating endpoints below narrow to their own
    // Section-level key instead (permissions are Page->Section only, no further Feature breakdown —
    // see AuthBootstrapSeeder's own header comment), so role CRUD can be granted/withheld
    // independently of merely being able to view either page — page:iam.roles-details only, since
    // role CRUD is exclusive to the IAM page now (NOT page:roles.roles-details, which no longer
    // exists in the catalog — see AuthBootstrapSeeder's own header comment on the move). New
    // Role/Edit Role/Delete are further distinguished only client-side, by Feature
    // (feature:new-role/edit-role/delete-role — IAMPage.js's SECTION_FEATURE_KEYS), same UI-only
    // caveat every other Feature carries (see feature-guard.js's own header comment) — this one
    // Section check is the real authorization boundary for all three actions.
    @GetMapping("/permissions")
    public List<PermissionOptionResponse> listPermissions() {
        return roleManagementService.listPermissions();
    }

    @GetMapping("/roles/details")
    public List<RoleSummaryResponse> listRoleSummaries() {
        return roleManagementService.listRoleSummaries();
    }

    @PostMapping("/roles")
    @ResponseStatus(HttpStatus.CREATED)
    @RequirePermission("page:iam.roles-details")
    public RoleSummaryResponse createRole(@RequestBody CreateRoleRequest request, HttpServletRequest servletRequest) {
        return roleManagementService.createRole(request, callerIsSuperAdmin(servletRequest));
    }

    @PutMapping("/roles/{id}")
    @RequirePermission("page:iam.roles-details")
    public RoleSummaryResponse updateRole(@PathVariable("id") Integer id, @RequestBody UpdateRoleRequest request,
                                           HttpServletRequest servletRequest) {
        return roleManagementService.updateRole(id, request, callerIsSuperAdmin(servletRequest));
    }

    @DeleteMapping("/roles/{id}")
    @RequirePermission("page:iam.roles-details")
    public void deleteRole(@PathVariable("id") Integer id, HttpServletRequest servletRequest) {
        roleManagementService.deleteRole(id, callerIsSuperAdmin(servletRequest));
    }

    // Re-resolved from the DB on every call (not the session's own cached AuthenticatedUser.roles)
    // so a mid-session role change takes effect immediately — same freshness guarantee
    // PermissionInterceptor/PageAccessInterceptor already rely on for every other check. Checks the
    // caller's real ROLE NAME (AuthService.isSuperAdmin), not a "page:superadmin" Permission — see
    // SystemRoles' own header comment for why a Permission-based check can no longer work here.
    private boolean callerIsSuperAdmin(HttpServletRequest servletRequest) {
        HttpSession session = servletRequest.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;
        if (authUser == null) {
            return false;
        }
        return authService.isSuperAdmin(authUser.getUserId());
    }
}
