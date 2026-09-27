package com.houseofbeauty.controller.pages.identity;

import com.houseofbeauty.dto.identity.request.CreateUserRequest;
import com.houseofbeauty.dto.identity.request.UpdateUserRequest;
import com.houseofbeauty.dto.identity.response.UserSummaryResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import com.houseofbeauty.service.identity.UserManagementService;
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

// Backs the "1. User Details" section of both the Roles & Users page (RolesPage.js) and the IAM
// page (IAMPage.js — an independently-permissioned second place to reach the exact same data): the
// "New User" popup, the table, and its Edit Profile/Delete row actions (password reset lives inside
// Edit Profile, not its own endpoint). The Roles checkbox list in that popup reuses the roles
// already loaded from RolesController's /roles/details, so this controller no longer needs its own
// role-listing endpoint. Gated behind "page:roles.user-details" OR "page:iam.user-details" — the
// Section itself (permissions are Page->Section only, no further Feature breakdown — see
// AuthBootstrapSeeder's own header comment), narrower than mere page:roles/page:iam access so a
// session that can see either page's shell but wasn't granted this specific section still can't
// touch user accounts via the API.
@RestController
@RequestMapping("/api/identity")
@RequirePermission({"page:roles.user-details", "page:iam.user-details"})
public class UsersController {

    private final UserManagementService userManagementService;
    private final AuthService authService;

    public UsersController(UserManagementService userManagementService, AuthService authService) {
        this.userManagementService = userManagementService;
        this.authService = authService;
    }

    @GetMapping("/users")
    public List<UserSummaryResponse> listUsers() {
        return userManagementService.listUsers();
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    public UserSummaryResponse createUser(@RequestBody CreateUserRequest request, HttpServletRequest servletRequest) {
        return userManagementService.createUser(request, callerIsSuperAdmin(servletRequest));
    }

    @PutMapping("/users/{id}")
    public UserSummaryResponse updateUser(@PathVariable("id") Long id, @RequestBody UpdateUserRequest request,
                                           HttpServletRequest servletRequest) {
        return userManagementService.updateUser(id, request, callerIsSuperAdmin(servletRequest));
    }

    @DeleteMapping("/users/{id}")
    public void deleteUser(@PathVariable("id") Long id) {
        userManagementService.deleteUser(id);
    }

    // Same freshness rationale as RolesController's own copy of this check — re-resolved from the
    // DB on every call rather than trusting the session's cached AuthenticatedUser.roles. Checks the
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
