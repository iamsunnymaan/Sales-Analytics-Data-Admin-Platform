package com.houseofbeauty.dto.sitedetail.response;

import java.math.BigDecimal;
import java.util.List;

public record TrendRangeResponse(String granularity, TrendPeriod period, List<String> labels, List<String> dates,
                                  List<BigDecimal> primaryData, List<BigDecimal> secondaryData,
                                  List<BigDecimal> totalData, List<BigDecimal> target, List<BigDecimal> lastYear) {
}
