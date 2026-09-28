package com.houseofbeauty.dto.teamperformance.response;

import java.math.BigDecimal;
import java.util.List;

public record PersonFyOverviewResponse(String name, String level, String fyKey, List<String> months,
                                        List<BigDecimal> primaryTarget, List<BigDecimal> primarySales,
                                        List<BigDecimal> primaryLastYearSales, List<BigDecimal> secondaryTarget,
                                        List<BigDecimal> secondarySales, List<BigDecimal> secondaryLastYearSales) {
}
