package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

/** One row in {@code ProductLevelResponse.subCategories} — the Sub-category ranked table. */
public record SubCategoryRow(String subCategory, BigDecimal salesValue, BigDecimal salesQty, BigDecimal vsLastYearPct,
                              BigDecimal vsLastMonthPct, BigDecimal contribPct, BigDecimal contribDeltaLYPct) {
}
