package com.houseofbeauty.service.common;

import java.util.Locale;

public final class OperationalStatusFilter {

    private OperationalStatusFilter() {
    }

    public static String whereClause(String status, String column) {
        if (status == null) {
            return "";
        }
        String normalized = status.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "active" -> " AND LOWER(" + column + ") LIKE '%active%' AND LOWER(" + column + ") NOT LIKE '%inactive%'";
            case "inactive" -> " AND LOWER(" + column + ") LIKE '%inactive%'";
            case "upcoming" -> " AND LOWER(" + column + ") LIKE '%upcoming%'";
            default -> "";
        };
    }

    public static String whereClause(String status) {
        return whereClause(status, "Operational_Status");
    }

    public static boolean matches(String status, String rawOperationalStatus) {
        if (status == null) {
            return true;
        }
        String normalized = status.trim().toLowerCase(Locale.ROOT);
        String value = rawOperationalStatus == null ? "" : rawOperationalStatus.toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "active" -> value.contains("active") && !value.contains("inactive");
            case "inactive" -> value.contains("inactive");
            case "upcoming" -> value.contains("upcoming");
            default -> true;
        };
    }
}
