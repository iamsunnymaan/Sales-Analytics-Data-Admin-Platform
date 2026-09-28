package com.houseofbeauty.dto.secondarysales.response;

import java.math.BigDecimal;
import java.util.List;

public record TrendRangeResponse(String granularity, String brand, TrendPeriod period, List<String> labels,
                                  List<String> dates, List<BigDecimal> data, List<BigDecimal> target,
                                  List<BigDecimal> lastYear) {
}
