package com.houseofbeauty.dto.secondarysales.response;

/** The [from, to] window (ISO date strings) a Secondary Sales response was computed over. */
public record TrendPeriod(String from, String to) {
}
