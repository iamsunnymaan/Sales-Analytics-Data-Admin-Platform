package com.houseofbeauty.dto.monitoring.response;

import java.util.List;

public record UsageStatsResponse(List<HourlyCount> byHour, List<UserCount> byUser) {

    public record HourlyCount(int hour, long count) {
    }

    public record UserCount(String username, long count) {
    }
}
