package com.houseofbeauty.dto.topprojection.request;

import java.math.BigDecimal;

/**
 * PUT /api/top-projection/{id}'s request body — confirms overwriting an existing Brand+Channel's
 * current-month row (see TopProjectionService#update) after the popup has shown the user the
 * previous value next to the new one they just typed. Only the value changes in place; Brand,
 * Channel and Month stay whatever they already were on that row.
 */
public record UpdateTopProjectionRequest(BigDecimal projectionValue) {
}
