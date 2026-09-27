package com.houseofbeauty.controller.pages.identity;

import com.houseofbeauty.dto.features.response.FeatureOptionResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.feature.FeatureManagementService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Feature catalog — consumed by RolesPage.js's Edit Role popup (Feature leaf nodes nested in the
// Permission tree, see SECTION_FEATURE_KEYS/renderFeatureNode there). Reuses the same
// "page:roles.user-details"/"page:iam.user-details" Section keys UsersController itself is gated
// behind (not the coarser page:roles/page:iam) — this consumes PermissionInterceptor purely as
// generic, annotation-driven infra (see that class's own header comment: it no-ops for any handler
// without the annotation), it does not read or write any Permission-system data. The per-user
// Feature-assignment endpoints (GET/PUT /users/{id}) and the Super Admin "Feature Bulk Management"
// matrix endpoint that used to live here were removed per explicit request along with their only
// callers (RolesPage.js/IAMPage.js's per-user Features field, and SuperAdminPage.js's Feature Bulk
// Management section) — don't re-add either unasked.
@RestController
@RequestMapping("/api/identity/features")
@RequirePermission({"page:roles.user-details", "page:iam.user-details"})
public class FeaturesController {

    private final FeatureManagementService featureManagementService;

    public FeaturesController(FeatureManagementService featureManagementService) {
        this.featureManagementService = featureManagementService;
    }

    @GetMapping
    public List<FeatureOptionResponse> listCatalog() {
        return featureManagementService.listCatalog();
    }
}
