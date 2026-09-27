package com.houseofbeauty.dto.teamperformance.response;

import java.math.BigDecimal;
import java.util.List;

// Person Details' own "Daily Sales" graph (see TeamPersonService#getPersonTrendRange) — combined
// Primary+Secondary Sales for one RM/AM/CM/SM person's whole assigned site set, day/month/year
// bucketed. Same shape as dto.sitedetail.response.TrendRangeResponse (that one scoped to a single
// site instead of a person's full site set) — labels/dates/primary/secondary/total/target/lastYear
// are all parallel arrays, one entry per bucket.
public record TrendRangeResponse(String granularity, TrendPeriod period, List<String> labels, List<String> dates,
                                  List<BigDecimal> primary, List<BigDecimal> secondary, List<BigDecimal> total,
                                  List<BigDecimal> target, List<BigDecimal> lastYear) {
}
