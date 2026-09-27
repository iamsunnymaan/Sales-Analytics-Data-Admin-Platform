package com.houseofbeauty.dto.secondarysales.response;

import java.math.BigDecimal;

/**
 * One (Brand, Channel) cell of the Secondary Sales page's "1. Overview" cross-tab — {@code brand}/
 * {@code channel} are either a real Site_Master value or the literal {@code "Total"} (a brand's own
 * per-brand total across its real channels, or the grand-total brand's own cells). {@code
 * monthTarget} is null when none of that cell's real Site_Codes have a Secondary_Sales_Target row
 * (never a fabricated 0); {@code pctVsTargetPct}/{@code sobPct} are null whenever their own
 * denominator is null or zero, for the same reason.
 */
public record OverviewCell(String brand, String channel, BigDecimal monthTarget, BigDecimal actualSales,
                            BigDecimal pctVsTargetPct, BigDecimal vsLastYearPct, BigDecimal sobPct) {
}
