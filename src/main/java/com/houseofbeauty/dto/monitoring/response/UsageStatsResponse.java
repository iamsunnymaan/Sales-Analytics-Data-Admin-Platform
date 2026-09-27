package com.houseofbeauty.dto.monitoring.response;

import java.util.List;

// Backs the Monitoring page's "Usage Overview" graph — derived from successful logins in
// IAM_Login_Login_Audit over the last 30 days (see MonitoringService#getUsageStats). byHour has
// exactly 24 entries (0-23, zero-filled) for "which time of day sees more/less activity"; byUser
// is sorted most-active-first for "whose usage" — capped to a reasonable top-N so one very active
// account can't make the chart unreadable.
public record UsageStatsResponse(List<HourlyCount> byHour, List<UserCount> byUser) {

    public record HourlyCount(int hour, long count) {
    }

    public record UserCount(String username, long count) {
    }
}
