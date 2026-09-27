package com.houseofbeauty.dto.primarysales.response;

/** The [from, to] window (ISO date strings) a Primary Sales response was computed over. */
public record TrendPeriod(String from, String to) {
}
