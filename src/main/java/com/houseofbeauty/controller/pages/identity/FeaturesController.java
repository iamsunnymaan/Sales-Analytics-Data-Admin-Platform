package com.houseofbeauty.controller.pages.identity;

import com.houseofbeauty.dto.features.response.FeatureOptionResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.feature.FeatureManagementService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

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
