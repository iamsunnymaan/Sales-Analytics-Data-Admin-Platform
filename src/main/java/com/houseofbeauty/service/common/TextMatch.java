package com.houseofbeauty.service.common;

import java.util.Locale;

/**
 * The one place every case-insensitive-but-spelling-still-matters text comparison in this app should
 * go through — Partner/Channel/Sub_Channel are free-text columns typed independently into several
 * different tables (Site_Master, Primary_Sales_Target, Secondary_Sales_Target, Primary_Sales_Projection,
 * ...), so the SAME real-world partner routinely ends up spelled with different casing/whitespace
 * across them (live-verified example, 2026-09-21: Secondary_Sales_Target stores "Nykaa-Offline" while
 * Primary_Sales_Target and Site_Master both store "Nykaa-offline" — an exact-case match on one of these
 * columns silently drops the mismatched rows out of whatever total/join is being computed, rather than
 * erroring, which is what makes this bug class so easy to ship unnoticed). This class does NOT fix typos
 * or genuinely different names ("Nykaa" vs "Nykaa Fashions" still won't match, and shouldn't) — it only
 * neutralizes case and leading/trailing whitespace, per explicit request: "if text is upper case and
 * lower case do not check, check only spelling is correct or not".
 *
 * <p>Two equivalent forms, pick whichever fits the call site:
 * <ul>
 *   <li>{@link #normalize} — for a Java-side Map/String key (e.g. grouping two tables' query results
 *   onto the same partner name before summing them — see DashboardOverviewService#collectPartnerTotals
 *   for the original fix this class generalizes).</li>
 *   <li>{@link #sql} — for a SQL JOIN/WHERE condition comparing the same column across two tables (or
 *   against a bind parameter) directly in the database — wraps a column reference in
 *   {@code LOWER(LTRIM(RTRIM(...)))}, the exact SQL shape already used ad hoc throughout this codebase
 *   for Channel filters (see DashboardOverviewService's own Channel-filter WHERE clauses) — this method
 *   just gives that shape one name instead of every call site re-typing it slightly differently.</li>
 * </ul>
 */
public final class TextMatch {

    private TextMatch() {
    }

    /** Trimmed + lowercased — safe as a Map key or for an equals() comparison; null stays null. */
    public static String normalize(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.ROOT);
    }

    /** True when both values are the same real text once case and surrounding whitespace are ignored. */
    public static boolean equalsIgnoreCase(String a, String b) {
        String na = normalize(a);
        String nb = normalize(b);
        return na != null && na.equals(nb);
    }

    /**
     * Wraps a raw SQL column reference (e.g. {@code "sm.Partner"}) for a case/whitespace-insensitive
     * comparison — use on BOTH sides of the {@code =} in a JOIN condition or WHERE clause comparing two
     * table columns, and on the bind-parameter side too if that parameter's value didn't already go
     * through {@link #normalize}. Example: {@code sql("sm.Partner") + " = " + sql("pst.Partner")}.
     */
    public static String sql(String columnRef) {
        return "LOWER(LTRIM(RTRIM(" + columnRef + ")))";
    }
}
