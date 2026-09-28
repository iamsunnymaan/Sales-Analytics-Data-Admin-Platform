package com.houseofbeauty.dto.sitedetail.response;

import java.math.BigDecimal;

public record RankedRow(String code, String name, BigDecimal sales, BigDecimal qty, BigDecimal contributionPct,
                         BigDecimal vsLastYearPct, BigDecimal vsLastMonthPct, BigDecimal contribDeltaLYPct) {
}
