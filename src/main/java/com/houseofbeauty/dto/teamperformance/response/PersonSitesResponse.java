package com.houseofbeauty.dto.teamperformance.response;

import java.util.List;

// Person Details card (TeamPersonService#getPersonSites) — persona identity (name/level) plus the
// full list of active site codes assigned to them and its own count.
public record PersonSitesResponse(String name, String level, int siteCount, List<PersonSiteRow> sites) {
}
