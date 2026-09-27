package com.houseofbeauty.controller.features;

import com.houseofbeauty.dto.features.response.FeatureMeResponse;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import com.houseofbeauty.service.feature.FeatureManagementService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

// The current session's own granted Feature keys — consumed by every page's
// Shared/js/feature-guard.js, not just RolesPage.js. Kept in its own package (controller.features,
// not controller.pages.identity) and deliberately carries NO @RequirePermission annotation, unlike
// FeaturesController: any authenticated session can call this (same reachability as
// GET /api/auth/me), regardless of whether it holds "page:roles.user-details" — a VIEWER account
// still needs to know its own granted Features to render its own pages correctly.
//
// Reads the session directly via AuthenticatedUser (a plain session-state POJO), the same
// convention AuthController.me()/PermissionInterceptor already use — deliberately does NOT depend
// on AuthService, so this stays a self-contained sibling to the Permission system rather than
// reaching into its internals.
@RestController
@RequestMapping("/api/features")
public class FeatureSelfController {

    private final FeatureManagementService featureManagementService;

    public FeatureSelfController(FeatureManagementService featureManagementService) {
        this.featureManagementService = featureManagementService;
    }

    @GetMapping("/me")
    public FeatureMeResponse me(HttpServletRequest servletRequest) {
        HttpSession session = servletRequest.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;
        if (authUser == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required. Please log in.");
        }
        return new FeatureMeResponse(authUser.getUserId(), featureManagementService.getGrantedFeatureKeys(authUser.getUserId()));
    }
}
