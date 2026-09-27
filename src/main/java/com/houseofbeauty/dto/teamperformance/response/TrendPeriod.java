package com.houseofbeauty.dto.teamperformance.response;

// [from, to] echoed back as plain ISO strings — same shape as
// dto.sitedetail.response.TrendPeriod, kept as its own record per this codebase's per-feature-own-
// dto convention (primarysales/secondarysales/sitedetail each already have their own copy).
public record TrendPeriod(String from, String to) {
}
