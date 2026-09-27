package com.houseofbeauty.dto.topprojection.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One row of the Projection Form popup's grid table (GET /api/top-projection/grid) — one row per
 * real Brand+Channel+Sub_Channel+Partner combination found in Site_Master, for the current
 * month, whether or not a Primary_Sales_Projection row already exists for it (see
 * TopProjectionService#getGrid). {@code projectionValue} is ALWAYS null here — the grid is a
 * fresh-entry form, never pre-filled, so an untouched row is never accidentally resubmitted with a
 * stale number. {@code lastValue} is that combo's existing Projection_Value already stored for this
 * month (read-only, for reference while typing) — null the same as {@code id}/{@code submittedAt}
 * when no submission exists yet. Every other field is always populated (Brand/Channel/Sub_Channel/
 * Partner/Month are the combo's own identity, known before any submission exists).
 */
public record TopProjectionGridRow(Long id, String brand, String channel, String subChannel, String partner,
                                    LocalDate month, BigDecimal projectionValue, BigDecimal lastValue,
                                    LocalDateTime submittedAt) {
}
