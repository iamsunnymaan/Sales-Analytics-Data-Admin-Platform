package com.houseofbeauty.service.common;

import java.util.Locale;

// Site Insight page's own Status toggle pill (All/Active/Inactive/Upcoming, SiteStatusPage.html/.js)
// — site_master.Operational_Status is free text (see that column's own header comment on
// SiteMaster.java), so this classifies it the same keyword-matching way every other free-text status
// column in this codebase is read (e.g. SiteStatusPage.js's own resolveSalesTypeFlags for
// Sales_Type). Shared across every query this toggle needs to scope — the Site Code picker itself
// (SiteStatusService), the Geo Map popup (DashboardGeoMapService), and the Compare modal
// (SiteCompareService) — so "Active" means exactly the same thing in all three places.
public final class OperationalStatusFilter {

    private OperationalStatusFilter() {
    }

    // A SQL fragment (leading " AND ...", safe to append straight after a WHERE clause) that narrows
    // to rows matching the given status, or "" for null/blank/"all" (no filter). Only ever built from
    // this fixed switch, never from the raw `status` string itself, so there's no injection surface
    // despite `status` being caller-supplied.
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

    // Same classification as whereClause above, for a caller filtering already-loaded Java rows (e.g.
    // PrimarySalesReportsService's own Site_Master rows, read into memory once and filtered
    // brand/channel-wise in Java rather than in SQL) instead of building a WHERE clause. true for
    // null/blank/"all" (no filter) or any status this class doesn't recognize, same "no filter" default
    // whereClause's own switch falls back to.
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
