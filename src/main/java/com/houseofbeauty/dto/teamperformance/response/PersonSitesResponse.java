package com.houseofbeauty.dto.teamperformance.response;

import java.util.List;

public record PersonSitesResponse(String name, String level, int siteCount, List<PersonSiteRow> sites) {
}
