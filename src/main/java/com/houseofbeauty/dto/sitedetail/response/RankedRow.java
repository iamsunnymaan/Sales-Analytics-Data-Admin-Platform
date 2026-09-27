package com.houseofbeauty.dto.sitedetail.response;

import java.math.BigDecimal;

/**
 * One row of the Product Snapshot ranking table — same shape at every level (Product/Category/
 * Sub-category), just grouped differently server-side (see SiteDetailProductLevelService). {@code
 * code} is the real Article_Code at Product level, null at Category/Sub-category level (there's no
 * single article code to show there). {@code vsLastYearPct}/{@code vsLastMonthPct}/
 * {@code contribDeltaLYPct} added so this ranking table can show the same growth/contribution-delta
 * columns Primary Sales' own Product Ranking panel does — same null-when-no-real-comparison
 * semantics GrowthMath.growthPct already establishes elsewhere in this app.
 */
public record RankedRow(String code, String name, BigDecimal sales, BigDecimal qty, BigDecimal contributionPct,
                         BigDecimal vsLastYearPct, BigDecimal vsLastMonthPct, BigDecimal contribDeltaLYPct) {
}
