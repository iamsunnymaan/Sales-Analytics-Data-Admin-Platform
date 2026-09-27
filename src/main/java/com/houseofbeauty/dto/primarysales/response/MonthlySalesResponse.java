package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

/**
 * GET /api/primary-sales/monthly's response — the Overview Insights card's Period Sales / Period
 * Target / Projection figures for whatever [from, to] month range the Insights card's own Filter has
 * selected (see PrimarySalesTodayService.getMonthlySales). "Previous period" is the immediately
 * preceding span of the same number of calendar months; "last year" is the same span shifted back
 * exactly one year, with an "elapsed" cut mirroring however far into the current period `to` falls,
 * for apples-to-apples comparisons. {@code topProjectionValue}/{@code previousMonthProjectionValue}/
 * {@code lastYearMonthProjectionValue} are always the real CURRENT calendar month's, the immediately
 * preceding month's, and the same month last year's Primary_Sales_Projection totals (see
 * TopProjectionService#getCurrentMonthProjectionTotal/#getProjectionTotalForMonth), independent of
 * whatever [from, to] was requested — the frontend only uses them as the Insights card's
 * "Projection" row when the selected period resolves to exactly the current month; any other shape
 * (a historical month, or any multi-month range) falls back to periodSales/lastYearElapsedSales and
 * relabels the row to "Actual Sales" instead. {@code currentMonthTarget}/{@code currentMonthSales}
 * are the same "always current month" idea applied to Target/Sales-to-date — the frontend uses them
 * for the Required Sales Per Day row so it always paces against the real current month, not whatever
 * multi-month span [from, to] covers.
 */
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
