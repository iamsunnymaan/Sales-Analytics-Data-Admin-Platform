package com.houseofbeauty.dto.teamperformance.response;

import java.math.BigDecimal;
import java.util.List;

public record TrendRangeResponse(String granularity, TrendPeriod period, List<String> labels, List<String> dates,
                                  List<BigDecimal> primary, List<BigDecimal> secondary, List<BigDecimal> total,
                                  List<BigDecimal> target, List<BigDecimal> lastYear) {
}
