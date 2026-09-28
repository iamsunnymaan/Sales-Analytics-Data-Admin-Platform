package com.houseofbeauty.dto.secondarysales.response;

import java.util.List;

public record OverviewResponse(List<String> brands, List<String> channels, List<OverviewCell> cells) {
}
