package com.houseofbeauty.service.teamperformance;

// One real, active site_master row's hierarchy assignment — shared shape between
// TeamPerformanceReportService's own RM->AM->CM->SM report and TeamPersonService's per-person
// drill-down (person sites list, FY overview, daily trend), both fed by TeamSiteRepository.
public record TeamSiteRow(String siteCode, String brand, String storeName, String salesType, String channel,
                           String partner, String rm, String am, String cm, String sm) {
}
