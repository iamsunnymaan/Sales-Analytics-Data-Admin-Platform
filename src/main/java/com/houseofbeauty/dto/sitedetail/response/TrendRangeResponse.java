package com.houseofbeauty.dto.sitedetail.response;

import java.math.BigDecimal;
import java.util.List;

/**
 * GET /api/site-detail/trend-range's response — this one site's Primary/Secondary/Total Sales series
 * (plus a combined Target overlay), bucketed by day/month/year depending on {@code granularity}.
 * {@code labels}/{@code dates}/{@code primaryData}/{@code secondaryData}/{@code totalData}/
 * {@code target}/{@code lastYear} are parallel arrays, one entry per bucket — same shape as Primary
 * Sales' own TrendRangeResponse, just split into Primary/Secondary/Total instead of a single Sales
 * series (this page already presents those three separately elsewhere — see the KPI row and Monthly
 * History table). {@code lastYear} is this same site's combined Total Sales (Primary+Secondary) for
 * the same period one year earlier, matching Primary/Secondary Sales's own "vs Last Year" overlay.
 */
public record TrendRangeResponse(String granularity, TrendPeriod period, List<String> labels, List<String> dates,
                                  List<BigDecimal> primaryData, List<BigDecimal> secondaryData,
                                  List<BigDecimal> totalData, List<BigDecimal> target, List<BigDecimal> lastYear) {
}
