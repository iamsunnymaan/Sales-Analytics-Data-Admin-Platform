package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

/** One row (a calendar month) in GET /api/primary-sales/monthly/breakdown's response. */
public record MonthlyBreakdownEntry(int year, int month, BigDecimal actualSales, BigDecimal target) {
}
