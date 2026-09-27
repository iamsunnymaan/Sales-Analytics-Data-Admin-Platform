package com.houseofbeauty.dto.sitedetail.response;

/** The [from, to] window (ISO date strings) a Site Detail trend response was computed over. */
public record TrendPeriod(String from, String to) {
}
