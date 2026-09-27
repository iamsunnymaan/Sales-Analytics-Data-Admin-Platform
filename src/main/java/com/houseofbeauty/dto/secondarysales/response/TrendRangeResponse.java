package com.houseofbeauty.dto.secondarysales.response;

import java.math.BigDecimal;
import java.util.List;

/**
 * GET /api/secondary-sales/trend-range's response — the Daily Sales Trends section's real amount
 * series, bucketed by day/month/year depending on {@code granularity}. {@code labels}/{@code dates}/
 * {@code data}/{@code target}/{@code lastYear} are parallel arrays, one entry per bucket.
 */
public record TrendRangeResponse(String granularity, String brand, TrendPeriod period, List<String> labels,
                                  List<String> dates, List<BigDecimal> data, List<BigDecimal> target,
                                  List<BigDecimal> lastYear) {
}
