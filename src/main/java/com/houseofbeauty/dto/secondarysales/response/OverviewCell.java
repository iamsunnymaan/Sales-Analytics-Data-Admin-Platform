package com.houseofbeauty.dto.secondarysales.response;

import java.math.BigDecimal;

public record OverviewCell(String brand, String channel, BigDecimal monthTarget, BigDecimal actualSales,
                            BigDecimal pctVsTargetPct, BigDecimal vsLastYearPct, BigDecimal sobPct) {
}
