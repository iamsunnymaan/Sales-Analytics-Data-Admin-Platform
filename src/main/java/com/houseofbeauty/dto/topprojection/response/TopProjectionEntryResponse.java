package com.houseofbeauty.dto.topprojection.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One row of Primary_Sales_Projection — both what GET /api/top-projection's list returns and what
 * POST /api/top-projection echoes back for the just-submitted entry (see TopProjectionService).
 */
public record TopProjectionEntryResponse(long id, String brand, String channel, String subChannel, String partner,
                                          LocalDate month, BigDecimal projectionValue, LocalDateTime submittedAt) {
}
