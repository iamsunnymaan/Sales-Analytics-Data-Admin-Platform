package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

public record MonthlyBreakdownEntry(int year, int month, BigDecimal actualSales, BigDecimal target) {
}
