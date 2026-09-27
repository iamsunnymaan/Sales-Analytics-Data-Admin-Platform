package com.houseofbeauty.service.common;

import java.util.Locale;

// Site Insight page's own Sales Type toggle pill (All/Primary/Secondary, SiteStatusPage.html/.js) —
// site_master.Sales_Type is free text, keyword-matched server-side the same way
// OperationalStatusFilter reads Operational_Status. A blank/unrecognized Sales_Type means "sells
// both" (mirrors SiteStatusPage.js's own resolveSalesTypeFlags, which defaults showPrimary/
// showSecondary to true when neither keyword is found), so "primary" keeps every row that isn't
// secondary-only, and "secondary" keeps every row that isn't primary-only.
public final class SiteSalesTypeFilter {

    private SiteSalesTypeFilter() {
    }

    // A SQL fragment (leading " AND ...", safe to append straight after a WHERE clause) that narrows
    // to rows matching the given sales type, or "" for null/blank/"all" (no filter). Only ever built
    // from this fixed switch, never from the raw `salesType` string itself, so there's no injection
    // surface despite `salesType` being caller-supplied. COALESCE guards a blank/NULL Sales_Type from
    // ever reading as "secondary-only"/"primary-only" under the LIKE checks below (ANSI-standard, so
    // no dialect branching needed here unlike ISNULL).
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
