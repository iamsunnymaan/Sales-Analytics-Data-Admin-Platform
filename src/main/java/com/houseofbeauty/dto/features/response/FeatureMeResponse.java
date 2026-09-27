package com.houseofbeauty.dto.features.response;

import java.util.List;

// GET /api/features/me — the CURRENT session's own granted Feature keys, consumed by
// Shared/js/feature-guard.js on every page. Deliberately a separate response/endpoint from
// /api/auth/me's MeResponse — see FeatureSelfController's own header comment.
public record FeatureMeResponse(Long userId, List<String> featureKeys) {
}
