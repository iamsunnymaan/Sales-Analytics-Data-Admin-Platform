package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

public record ProductRow(int index, String articleCode, String description, String category, String subCategory,
                          String ean, String hsn, BigDecimal tax, BigDecimal salesValue, BigDecimal salesQty,
                          BigDecimal vsLastYearPct, BigDecimal vsLastMonthPct, BigDecimal contribPct) {
}
