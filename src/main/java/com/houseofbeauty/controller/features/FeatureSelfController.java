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
