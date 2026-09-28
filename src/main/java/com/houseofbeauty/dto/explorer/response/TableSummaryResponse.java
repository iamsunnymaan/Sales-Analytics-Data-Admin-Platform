package com.houseofbeauty.dto.explorer.response;

import java.time.LocalDateTime;


public record TableSummaryResponse(String name, LocalDateTime lastUpdated, boolean duplicateCheckEnabled) {
}
