package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;
import java.util.List;

/**
 * GET /api/primary-sales/trend-range's response — the Daily Trend Graph section's real amount
 * series, bucketed by day/month/year depending on {@code granularity}. {@code labels}/{@code dates}/
 * {@code data}/{@code target}/{@code lastYear} are parallel arrays, one entry per bucket.
 */
public record TrendRangeResponse(String granularity, String brand, TrendPeriod period, List<String> labels,
                                  List<String> dates, List<BigDecimal> data, List<BigDecimal> target,
                                  List<BigDecimal> lastYear) {
}
