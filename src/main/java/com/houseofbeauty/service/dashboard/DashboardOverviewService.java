package com.houseofbeauty.service.dashboard;

import com.houseofbeauty.service.common.OperationalStatusFilter;
import com.houseofbeauty.service.common.TextMatch;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;

// Backs the Dashboard (index.html) page's own "1. Overview" Financial Year table — real per-month
// Primary_Sales_Target/Secondary_Sales_Target/Primary_Sales/Secondary_Sales totals for a given
// financial year (April of fyStartYear through March of fyStartYear+1), optionally scoped down by
// Brand/Channel/Status (the "Filter Header" section's own Sales Type/Brand/Channel/Status pills) —
// null brand/channel/status means every real value, matching the original brand-agnostic behavior.
// `brand` is expected already resolved to the real Primary_Sales/Secondary_Sales/Primary_Sales_
// Target/Secondary_Sales_Target vocabulary (e.g. "Anastasia Beverly hills") — same product-name
// vocabulary DashboardDailyTrendService's own header comment confirms all four fact tables share via
// their FK to site_master(Site_Code, Brand), so a direct `Brand = ?` filter always works with no join
// needed. Channel/Status are different per table: Primary_Sales_Target carries its own Channel column
// directly (but never Operational_Status, which only ever lives on Site_Master), while Primary_Sales/
// Secondary_Sales/Secondary_Sales_Target don't carry Channel at all — those three need a join back to
// Site_Master (on Site_Code/Bill_to + Brand) to filter by either Channel or Status, only added when
// one of the two is actually active (skipping the join entirely when neither is needed).
@Service
public class DashboardOverviewService {

    private final JdbcTemplate jdbcTemplate;

    public DashboardOverviewService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    // Keyed "yyyy-MM" (e.g. "2026-04"), one entry per month of the FY, pre-seeded to zero so a month
    // with no rows yet still appears instead of being silently missing.
    private Map<String, BigDecimal> seededMonths(int fyStartYear) {
        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        YearMonth start = YearMonth.of(fyStartYear, 4);
        for (int i = 0; i < 12; i++) {
            totals.put(start.plusMonths(i).toString(), BigDecimal.ZERO);
        }
        return totals;
    }

    private void collectMonthlyTotals(Map<String, BigDecimal> totals, String sql, Object... params) {
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            YearMonth ym = YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue());
            totals.put(ym.toString(), asDecimal(row.get("total")));
        }
    }

    // Primary_Sales_Target has Brand and Channel as direct columns, but never Operational_Status —
    // a Status filter still needs a join back to Site_Master even though Channel alone wouldn't.
    public Map<String, BigDecimal> getPrimarySalesTargetByMonth(int fyStartYear, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = seededMonths(fyStartYear);
        YearMonth start = YearMonth.of(fyStartYear, 4);
        boolean needsJoin = status != null;
        List<Object> params = new ArrayList<>(List.of(start.atDay(1), start.plusMonths(11).atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(t.Month) AS yr, MONTH(t.Month) AS mo, SUM(t.Sales_Target) AS total FROM Primary_Sales_Target t ");
        if (needsJoin) {
            sql.append("JOIN Site_Master sm ON sm.Site_Code = t.Site_Code AND sm.Brand = t.Brand ");
        }
        sql.append("WHERE t.Month BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND t.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(t.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY YEAR(t.Month), MONTH(t.Month)");
        collectMonthlyTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Secondary_Sales_Target has Brand directly but no Channel/Status column (its real key is
    // Site_Code+Brand+Partner+Month) — a Channel or Status filter needs a join back to Site_Master.
    public Map<String, BigDecimal> getSecondarySalesTargetByMonth(int fyStartYear, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = seededMonths(fyStartYear);
        YearMonth start = YearMonth.of(fyStartYear, 4);
        boolean needsJoin = channel != null || status != null;
        List<Object> params = new ArrayList<>(List.of(start.atDay(1), start.plusMonths(11).atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(t.Month) AS yr, MONTH(t.Month) AS mo, SUM(t.Sales_Target) AS total FROM Secondary_Sales_Target t ");
        if (needsJoin) {
            sql.append("JOIN Site_Master sm ON sm.Site_Code = t.Site_Code AND sm.Brand = t.Brand ");
        }
        sql.append("WHERE t.Month BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND t.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY YEAR(t.Month), MONTH(t.Month)");
        collectMonthlyTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Primary_Sales has Brand directly but no Channel/Status column — a Channel or Status filter
    // needs a join back to Site_Master via Bill_to (Primary_Sales' own site-code column) + Brand.
    public Map<String, BigDecimal> getPrimarySalesActualByMonth(int fyStartYear, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = seededMonths(fyStartYear);
        YearMonth start = YearMonth.of(fyStartYear, 4);
        boolean needsJoin = channel != null || status != null;
        List<Object> params = new ArrayList<>(List.of(start.atDay(1), start.plusMonths(11).atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(ps.Sales_Date) AS yr, MONTH(ps.Sales_Date) AS mo, SUM(ps.Sales) AS total FROM Primary_Sales ps ");
        if (needsJoin) {
            sql.append("JOIN Site_Master sm ON sm.Site_Code = ps.Bill_to AND sm.Brand = ps.Brand ");
        }
        sql.append("WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND ps.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY YEAR(ps.Sales_Date), MONTH(ps.Sales_Date)");
        collectMonthlyTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Same as getPrimarySalesActualByMonth above, joined via Secondary_Sales' own Site_Code column
    // instead of Bill_to.
    public Map<String, BigDecimal> getSecondarySalesActualByMonth(int fyStartYear, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = seededMonths(fyStartYear);
        YearMonth start = YearMonth.of(fyStartYear, 4);
        boolean needsJoin = channel != null || status != null;
        List<Object> params = new ArrayList<>(List.of(start.atDay(1), start.plusMonths(11).atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(ss.Sales_Date) AS yr, MONTH(ss.Sales_Date) AS mo, SUM(ss.Sales) AS total FROM Secondary_Sales ss ");
        if (needsJoin) {
            sql.append("JOIN Site_Master sm ON sm.Site_Code = ss.Site_Code AND sm.Brand = ss.Brand ");
        }
        sql.append("WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND ss.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY YEAR(ss.Sales_Date), MONTH(ss.Sales_Date)");
        collectMonthlyTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Real distinct Site_Master.Channel values — backs this section's own Channel filter pill, same
    // "offline"/"Offline" case-folding convention TopProjectionService/PrimarySalesReportsService's
    // own normalizeChannelDisplay use, so the dropdown shows one tidy entry per real channel instead
    // of two near-duplicates.
    public List<String> getAvailableChannels() {
        String sql = "SELECT DISTINCT Channel FROM Site_Master WHERE Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> ''";
        TreeSet<String> channels = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String channel : jdbcTemplate.queryForList(sql, String.class)) {
            channels.add(normalizeChannelDisplay(channel));
        }
        return new ArrayList<>(channels);
    }

    private static String normalizeChannelDisplay(String channel) {
        String lower = channel.trim().toLowerCase(Locale.ROOT);
        return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
    }

    // Real distinct Site_Master.Sales_Type values ("Primary Sales"/"Secondary Sales" today) — backs
    // this section's own Sales Type filter pill, same query TopProjectionService's own
    // getAvailableSaleTypes uses for its own Sale Type pill.
    public List<String> getAvailableSalesTypes() {
        String sql = "SELECT DISTINCT Sales_Type FROM Site_Master WHERE Sales_Type IS NOT NULL AND LTRIM(RTRIM(Sales_Type)) <> ''";
        TreeSet<String> types = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String type : jdbcTemplate.queryForList(sql, String.class)) {
            types.add(type.trim());
        }
        return new ArrayList<>(types);
    }

    // Status pill options — backs the "Filter Header" section's own Status pill
    // (GET /api/dashboard/statuses), fetched the same way Brand/Sales Type/Channel above already are
    // instead of the pill's All/Active/Inactive/Upcoming buttons being hardcoded straight into
    // index.html. The category list itself (Active/Inactive/Upcoming) is the same fixed, app-wide Site
    // Status vocabulary OperationalStatusFilter classifies against — NOT derived from Site_Master's own
    // live distinct Operational_Status text (that column is free text with no canonical enumeration to
    // query, see OperationalStatusFilter's own header comment). The real Site_Master COUNT(*) round-trip
    // below (not a hardcoded return) is what surfaces both a genuine DB-connectivity problem (query
    // throws, propagates as a 500) AND an empty/not-yet-imported Site_Master (count is 0) as an empty
    // list here, per explicit request — letting the frontend fall back to the same "Not Available" state
    // Brand/Sales Type/Channel's own empty-list fetch failure already shows (see PrimarySalesTodayService's
    // own getAvailableStatuses, the first place this convention was introduced).
    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM Site_Master", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    // Real distinct Site_Master.Partner values — backs "3. Partner Wise Target Vs Achievement"'s own
    // Partner column (one row per real Partner instead of frontend-mock names), scoped by the same
    // "Filter Header" section's Sales Type/Brand/Channel/Status pills the rest of this service already
    // respects. No join needed — Sales_Type/Brand/Channel/Partner/Operational_Status all live directly
    // on Site_Master itself.
    public List<String> getAvailablePartners(String salesType, String brand, String channel, String status) {
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder(
                "SELECT DISTINCT Partner FROM Site_Master WHERE Partner IS NOT NULL AND LTRIM(RTRIM(Partner)) <> '' ");
        if (salesType != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(Sales_Type))) = LOWER(?) ");
            params.add(salesType);
        }
        if (brand != null) {
            sql.append("AND Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status));
        }
        TreeSet<String> partners = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String partner : jdbcTemplate.queryForList(sql.toString(), params.toArray(), String.class)) {
            partners.add(partner.trim());
        }
        return new ArrayList<>(partners);
    }

    // Merges one Partner->total map into a running one (Total, not overwrite) — used by
    // getPartnerTargetTotals/getPartnerActualTotals below to combine Primary + Secondary onto the same
    // Partner name when the Sales Type filter is "all" (both).
    private void mergeAdd(Map<String, BigDecimal> into, Map<String, BigDecimal> from) {
        from.forEach((partner, value) -> into.merge(partner, value, BigDecimal::add));
    }

    // Keyed by LOWERCASED trimmed Partner name (not month, unlike collectMonthlyTotals above) — a
    // Partner absent from the query result for this window simply has no entry in the returned map
    // (callers treat a missing key as zero, same convention getPrimarySalesTargetByMonth's own
    // seededMonths establishes for months, just without the pre-seeding since the real Partner list
    // itself comes from a separate call — see getAvailablePartners above / DashboardController's own
    // /partners endpoint). Lowercased per explicit bug fix (2026-09-21, live-verified via SQL): the
    // SAME logical partner is spelled with different casing across tables — e.g. Secondary_Sales_Target
    // stores "Nykaa-Offline" while Primary_Sales_Target and Site_Master both store "Nykaa-offline" —
    // so an exact-case key was silently dropping Secondary's ₹51,010,704 Target for that partner out of
    // "3. Partner Wise Target Vs Achievement"'s own Total row (Overview's own flat table SUM never hit
    // this since it doesn't group by Partner at all, which is exactly why Overview's YTD Target read
    // ₹68.8 Cr while this table's own Total read ₹63.7 Cr for the identical window/filters). Dashboard.js's
    // own lookups (ytdTargetMap[partner.toLowerCase()] etc.) must stay lowercased in lockstep with this.
    // Now goes through TextMatch.normalize — the same generalized "case/whitespace-insensitive, spelling
    // still matters" helper this whole bug class got fixed under app-wide, per explicit follow-up request
    // — instead of its own inline .trim().toLowerCase(), so every future Partner/Channel/Sub_Channel
    // grouping in this codebase has one obvious, already-correct way to do this.
    private void collectPartnerTotals(Map<String, BigDecimal> totals, String sql, Object... params) {
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            Object partner = row.get("partner");
            if (partner == null) {
                continue;
            }
            totals.merge(TextMatch.normalize(partner.toString()), asDecimal(row.get("total")), BigDecimal::add);
        }
    }

    // "3. Partner Wise Target Vs Achievement" own "YTD ..." column group — real per-Partner Target for
    // [fromMonth, toMonth] (the FY-start..last-COMPLETE-month window Dashboard.js's own
    // updateDashboardPartnerYtdLabel computes), straight SUM(Sales_Target) grouped by Partner directly
    // off Primary_Sales_Target/Secondary_Sales_Target — same simple, no-combo-matching convention
    // "1. Overview" itself uses (getPrimarySalesTargetByMonth above), per explicit request, rather than
    // PrimarySalesReportsService's own more elaborate Site_Master-combo-matched Reports-page convention.
    private Map<String, BigDecimal> getPrimaryTargetByPartner(YearMonth fromMonth, YearMonth toMonth, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = new HashMap<>();
        boolean needsJoin = status != null;
        List<Object> params = new ArrayList<>(List.of(fromMonth.atDay(1), toMonth.atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT t.Partner AS partner, SUM(t.Sales_Target) AS total FROM Primary_Sales_Target t ");
        if (needsJoin) {
            sql.append("JOIN Site_Master sm ON sm.Site_Code = t.Site_Code AND sm.Brand = t.Brand ");
        }
        sql.append("WHERE t.Month BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND t.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(t.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY t.Partner");
        collectPartnerTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Same as getPrimaryTargetByPartner above, off Secondary_Sales_Target instead — that table has no
    // Channel column of its own (see getSecondarySalesTargetByMonth's own comment), so a Channel filter
    // needs the Site_Master join even when Status doesn't.
    private Map<String, BigDecimal> getSecondaryTargetByPartner(YearMonth fromMonth, YearMonth toMonth, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = new HashMap<>();
        boolean needsJoin = channel != null || status != null;
        List<Object> params = new ArrayList<>(List.of(fromMonth.atDay(1), toMonth.atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT t.Partner AS partner, SUM(t.Sales_Target) AS total FROM Secondary_Sales_Target t ");
        if (needsJoin) {
            sql.append("JOIN Site_Master sm ON sm.Site_Code = t.Site_Code AND sm.Brand = t.Brand ");
        }
        sql.append("WHERE t.Month BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND t.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY t.Partner");
        collectPartnerTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Real per-Partner Actual Sales for [fromMonth, toMonth] off Primary_Sales — Partner itself only
    // ever lives on Site_Master, so (unlike Target above) this join is never optional, joined via
    // Bill_to same as getPrimarySalesActualByMonth above.
    private Map<String, BigDecimal> getPrimaryActualByPartner(YearMonth fromMonth, YearMonth toMonth, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = new HashMap<>();
        List<Object> params = new ArrayList<>(List.of(fromMonth.atDay(1), toMonth.atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT sm.Partner AS partner, SUM(ps.Sales) AS total FROM Primary_Sales ps " +
                        "JOIN Site_Master sm ON sm.Site_Code = ps.Bill_to AND sm.Brand = ps.Brand " +
                        "WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND ps.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY sm.Partner");
        collectPartnerTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Same as getPrimaryActualByPartner above, off Secondary_Sales instead, joined via its own
    // Site_Code column same as getSecondarySalesActualByMonth above.
    private Map<String, BigDecimal> getSecondaryActualByPartner(YearMonth fromMonth, YearMonth toMonth, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = new HashMap<>();
        List<Object> params = new ArrayList<>(List.of(fromMonth.atDay(1), toMonth.atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT sm.Partner AS partner, SUM(ss.Sales) AS total FROM Secondary_Sales ss " +
                        "JOIN Site_Master sm ON sm.Site_Code = ss.Site_Code AND sm.Brand = ss.Brand " +
                        "WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND ss.Brand = ? ");
            params.add(brand);
        }
        if (channel != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) ");
            params.add(channel);
        }
        if (status != null) {
            sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        }
        sql.append("GROUP BY sm.Partner");
        collectPartnerTotals(totals, sql.toString(), params.toArray());
        return totals;
    }

    // Combines Primary_Sales_Target/Secondary_Sales_Target per Partner per whichever Sales Type is
    // selected ("Primary Sales"/"Secondary Sales" resolve to just that one table's own totals; null
    // ("all") sums both onto the same Partner name) — backs the "YTD ..." group's own Target column.
    public Map<String, BigDecimal> getPartnerTargetTotals(YearMonth fromMonth, YearMonth toMonth, String salesType, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = new HashMap<>();
        if (salesType == null || "Primary Sales".equalsIgnoreCase(salesType)) {
            mergeAdd(totals, getPrimaryTargetByPartner(fromMonth, toMonth, brand, channel, status));
        }
        if (salesType == null || "Secondary Sales".equalsIgnoreCase(salesType)) {
            mergeAdd(totals, getSecondaryTargetByPartner(fromMonth, toMonth, brand, channel, status));
        }
        return totals;
    }

    // Same combination as getPartnerTargetTotals above, off Primary_Sales/Secondary_Sales Actual Sales
    // instead — backs the "YTD ..." group's own Achi column (and, given a PRIOR-year [fromMonth,
    // toMonth] window, its Vs LY column too — see DashboardController's own /partner-overview/actual
    // endpoint, called twice by Dashboard.js's loadDashboardPartners for this and last year).
    public Map<String, BigDecimal> getPartnerActualTotals(YearMonth fromMonth, YearMonth toMonth, String salesType, String brand, String channel, String status) {
        Map<String, BigDecimal> totals = new HashMap<>();
        if (salesType == null || "Primary Sales".equalsIgnoreCase(salesType)) {
            mergeAdd(totals, getPrimaryActualByPartner(fromMonth, toMonth, brand, channel, status));
        }
        if (salesType == null || "Secondary Sales".equalsIgnoreCase(salesType)) {
            mergeAdd(totals, getSecondaryActualByPartner(fromMonth, toMonth, brand, channel, status));
        }
        return totals;
    }
}
