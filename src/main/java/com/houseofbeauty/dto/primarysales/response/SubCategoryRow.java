package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

public record SubCategoryRow(String subCategory, BigDecimal salesValue, BigDecimal salesQty, BigDecimal vsLastYearPct,
                              BigDecimal vsLastMonthPct, BigDecimal contribPct, BigDecimal contribDeltaLYPct) {
}
