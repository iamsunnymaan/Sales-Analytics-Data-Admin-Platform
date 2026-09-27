package com.houseofbeauty.dto.sitecompare;

// One (Site_Code, Brand) pick from the Compare modal's own "Selected Stores" tab (SiteStatusPage.js) —
// site_master's PK is that composite pair, so both are required to identify a real row.
public record SitePairDto(String siteCode, String brand) {
}
