package com.houseofbeauty.dto.features.response;

import java.util.List;

public record FeatureMeResponse(Long userId, List<String> featureKeys) {
}
