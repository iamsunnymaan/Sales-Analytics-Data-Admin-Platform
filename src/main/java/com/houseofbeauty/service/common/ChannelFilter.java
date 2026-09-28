package com.houseofbeauty.service.common;

public final class ChannelFilter {

    private ChannelFilter() {
    }

    public static String normalize(String channel) {
        return (channel == null || channel.isBlank() || "all".equalsIgnoreCase(channel)) ? null : channel;
    }
}
