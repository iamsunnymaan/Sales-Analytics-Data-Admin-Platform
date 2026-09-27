package com.houseofbeauty.dto.features.response;

// GET /api/identity/features — the full Feature catalog, for the RolesPage.js checkbox list.
public record FeatureOptionResponse(Integer featureId, String featureKey, String label, String description) {
}
