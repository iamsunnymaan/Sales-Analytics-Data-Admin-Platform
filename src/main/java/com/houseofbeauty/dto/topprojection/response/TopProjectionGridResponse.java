package com.houseofbeauty.dto.topprojection.response;

import java.util.List;

/**
 * GET /api/top-projection/grid's response — the Projection Form popup's full grid table for the
 * selected Brand ("all"/"ABH"/"Kylie", see TopProjectionService#getGrid): every real Site_Master
 * Channel×Partner combination for that brand (both brands, for "all"), plus the current month's
 * label the popup displays (never a raw date, see {@code currentMonthLabel}).
 */
public record TopProjectionGridResponse(List<TopProjectionGridRow> rows, String currentMonth, String currentMonthLabel) {
}
