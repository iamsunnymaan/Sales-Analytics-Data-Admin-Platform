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
