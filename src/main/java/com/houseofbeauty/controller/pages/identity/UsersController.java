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
