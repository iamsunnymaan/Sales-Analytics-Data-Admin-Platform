package com.houseofbeauty.dto.teamperformance.response;

import java.math.BigDecimal;
import java.util.List;

// Person Details' own FY card (TeamPersonService#getPersonFyOverview) — same Month x
// Primary/Secondary Target/Sales/Achi./Vs Last Year shape Dashboard's own "1. Overview" FY table
// uses (index.html#dashboardFyOverviewCard / Dashboard.js's renderDashboardFyOverviewTable), scoped
// to one RM/AM/CM/SM person's whole assigned site set instead of the whole business. Achi.% and Vs
// Last Year are derived client-side from target/sales/lastYearSales, same as the Dashboard table
// does — this only carries the raw per-month figures. `months` and every *Target/*Sales/
// *LastYearSales list are parallel arrays, one entry per calendar month of the requested FY
// (April..March).
public record PersonFyOverviewResponse(String name, String level, String fyKey, List<String> months,
                                        List<BigDecimal> primaryTarget, List<BigDecimal> primarySales,
                                        List<BigDecimal> primaryLastYearSales, List<BigDecimal> secondaryTarget,
                                        List<BigDecimal> secondarySales, List<BigDecimal> secondaryLastYearSales) {
}
