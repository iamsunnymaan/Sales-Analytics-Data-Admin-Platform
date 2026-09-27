package com.houseofbeauty.service.common;

/**
 * Normalizes a Channel query param the same way {@link BrandFilter} normalizes Brand — "all" (or
 * blank/null) means no filter, every other value is passed straight through and matched
 * case-insensitively against {@code Site_Master.Channel} by whichever service receives it. Unlike
 * Brand, Channel has no fixed two-value enum (its real vocabulary comes from whatever
 * {@code Site_Master.Channel} currently contains, see e.g.
 * {@code PrimarySalesTodayService#getAvailableChannels}), so there is nothing else to translate
 * here — this class exists only so every Channel-filterable endpoint applies the exact same
 * "all"-means-no-filter rule instead of each one re-deriving it slightly differently.
 */
public final class ChannelFilter {

    private ChannelFilter() {
    }

    public static String normalize(String channel) {
        return (channel == null || channel.isBlank() || "all".equalsIgnoreCase(channel)) ? null : channel;
    }
}
