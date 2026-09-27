package com.houseofbeauty.dto.teamperformance.response;

// One assigned site row for the Person Details card's site-code list (TeamPersonService#getPersonSites).
public record PersonSiteRow(String siteCode, String brand, String storeName, String salesType) {
}
