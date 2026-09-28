package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;


public record MonthlySalesResponse(BigDecimal periodSales, BigDecimal periodTransactions, BigDecimal periodQty,
                                    BigDecimal previousPeriodSales, BigDecimal previousPeriodTransactions,
                                    BigDecimal previousPeriodQty, BigDecimal lastYearFullPeriodSales,
                                    BigDecimal lastYearElapsedSales, BigDecimal lastYearElapsedTransactions,
                                    BigDecimal lastYearElapsedQty, BigDecimal periodTarget,
                                    BigDecimal previousPeriodTarget, BigDecimal lastYearPeriodTarget,
                                    BigDecimal topProjectionValue, BigDecimal currentMonthTarget,
                                    BigDecimal currentMonthSales, BigDecimal previousMonthProjectionValue,
                                    BigDecimal lastYearMonthProjectionValue) {
}
