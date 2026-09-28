package com.houseofbeauty.service.common;

import java.util.Locale;


public final class SiteSalesTypeFilter {

    private SiteSalesTypeFilter() {
    }


    public static String whereClause(String salesType) {
        if (salesType == null) {
            return "";
        }
        String normalized = salesType.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "primary" -> " AND (LOWER(COALESCE(Sales_Type, '')) NOT LIKE '%secondary%' " +
                    "OR LOWER(COALESCE(Sales_Type, '')) LIKE '%primary%')";
            case "secondary" -> " AND (LOWER(COALESCE(Sales_Type, '')) NOT LIKE '%primary%' " +
                    "OR LOWER(COALESCE(Sales_Type, '')) LIKE '%secondary%')";
            default -> "";
        };
    }
}
