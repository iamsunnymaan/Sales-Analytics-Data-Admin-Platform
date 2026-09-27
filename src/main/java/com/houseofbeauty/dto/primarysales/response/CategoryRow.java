package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

/** One row in {@code ProductLevelResponse.categories} — the Category ranked table. */
public record CategoryRow(String category, BigDecimal salesValue, BigDecimal salesQty, BigDecimal vsLastYearPct,
                           BigDecimal vsLastMonthPct, BigDecimal contribPct, BigDecimal contribDeltaLYPct) {
}
