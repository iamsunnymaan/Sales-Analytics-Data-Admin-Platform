package com.houseofbeauty.service.primarysales;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.Map;

// Reads the real Primary_Sales_Target table — columns Site_Code, Brand, Partner, Channel, Month
// (first-of-month date), Sales_Target (its former TargetID surrogate PK was dropped — the table's
// only remaining identifier is the DB-enforced UQ_PrimaryTarget unique constraint) — for callers
// that want a whole-table-for-the-brand sum with NO
// Site_Master combo matching (same brand-filter convention "all"/"abh"/"kylie" -> null/"ABH"/"Kylie"
// as PrimarySalesProductLevelService and friends). The Overview Insights card's own Month Target does
// NOT use this class any more — it now goes through PrimarySalesReportsService#getComboMatchedTarget
// Sum instead, to match "5. Reports"' Mnt exactly (see PrimarySalesTodayService#getMonthlySales).
// getTargetsByChannelInRange gives PrimarySalesReportsService real per-Channel targets straight from
// each row's own Channel column (getTargetsByPartnerInRange is the same idea grouped by Partner
// instead, currently unused — no caller since the section it used to back was removed). Every other
// method here stays at the Brand/Month rollup level.
@Service
public class PrimarySalesTargetService {

    private final JdbcTemplate jdbcTemplate;

    public PrimarySalesTargetService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public BigDecimal getMonthlyTarget(YearMonth month, String brandFilter) {
        String sql = "SELECT SUM(Sales_Target) FROM Primary_Sales_Target WHERE Month = ?"
                + (brandFilter != null ? " AND Brand = ?" : "");
        BigDecimal total = brandFilter != null
                ? jdbcTemplate.queryForObject(sql, BigDecimal.class, month.atDay(1), brandFilter)
                : jdbcTemplate.queryForObject(sql, BigDecimal.class, month.atDay(1));
        return total == null ? BigDecimal.ZERO : total;
    }

    // Real per-month targets for January through `uptoMonth` of `year` — backs the Monthly Sales
    // card's month-basis Outstanding breakdown, where each month is netted against its OWN real
    // target rather than one flat number reused for every month.
    public Map<Integer, BigDecimal> getMonthlyTargetsForYear(int year, int uptoMonth, String brandFilter) {
        String sql = "SELECT MONTH(Month) AS m, SUM(Sales_Target) AS total FROM Primary_Sales_Target "
                + "WHERE YEAR(Month) = ? AND MONTH(Month) <= ?"
                + (brandFilter != null ? " AND Brand = ?" : "")
                + " GROUP BY MONTH(Month)";
        Object[] params = brandFilter != null
                ? new Object[] { year, uptoMonth, brandFilter }
                : new Object[] { year, uptoMonth };

        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put(((Number) row.get("m")).intValue(), total);
        }
        return totals;
    }

    // Real per-month targets for every month in [from, to] (inclusive, arbitrary span, possibly
    // crossing years) — backs the Daily Trend Graph's target line/thread overlay.
    public Map<YearMonth, BigDecimal> getMonthlyTargetsInRange(YearMonth from, YearMonth to, String brandFilter) {
        String sql = "SELECT YEAR(Month) AS yr, MONTH(Month) AS mo, SUM(Sales_Target) AS total FROM Primary_Sales_Target "
                + "WHERE Month BETWEEN ? AND ?"
                + (brandFilter != null ? " AND Brand = ?" : "")
                + " GROUP BY YEAR(Month), MONTH(Month)";
        Object[] params = brandFilter != null
                ? new Object[] { from.atDay(1), to.atEndOfMonth(), brandFilter }
                : new Object[] { from.atDay(1), to.atEndOfMonth() };

        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put(YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue()), total);
        }
        return totals;
    }

    // Real Target per Partner value (e.g. "Nykaa", "Mall", "Tira Online") summed across every month
    // in [from, to] inclusive. Reads straight off Primary_Sales_Target's own Partner column rather
    // than going through Site_Master, since a target row already says which channel it belongs to.
    // Takes a [from, to] range rather than one Month for the same reason getTargetSumInRange does —
    // a multi-month Filter (e.g. July-August) must sum every one of those months' targets, not just
    // periodTo's single month, or this ends up short of the real total Overview shows for the same
    // range (a single-month call is just from == to). Currently unused — no caller since the section
    // it used to back (PrimarySalesRegionSummaryService's Channel Report) was removed per explicit
    // request; kept as a ready-made building block rather than deleted outright.
    public Map<String, BigDecimal> getTargetsByPartnerInRange(YearMonth from, YearMonth to, String brandFilter) {
        String sql = "SELECT Partner, SUM(Sales_Target) AS total FROM Primary_Sales_Target WHERE Month BETWEEN ? AND ?"
                + (brandFilter != null ? " AND Brand = ?" : "")
                + " GROUP BY Partner";
        Object[] params = brandFilter != null
                ? new Object[] { from.atDay(1), to.atDay(1), brandFilter }
                : new Object[] { from.atDay(1), to.atDay(1) };

        Map<String, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put((String) row.get("Partner"), total);
        }
        return totals;
    }

    // Real Target per Channel value (e.g. "Online"/"Offline") summed across every month in [from, to]
    // inclusive — backs "5. Reports"' Channel tab (PrimarySalesReportsService.getChannelSummaries).
    // Same range-summing rationale as getTargetsByPartnerInRange above, just grouped by the Channel
    // column instead of Partner.
    public Map<String, BigDecimal> getTargetsByChannelInRange(YearMonth from, YearMonth to, String brandFilter) {
        String sql = "SELECT Channel, SUM(Sales_Target) AS total FROM Primary_Sales_Target WHERE Month BETWEEN ? AND ?"
                + (brandFilter != null ? " AND Brand = ?" : "")
                + " GROUP BY Channel";
        Object[] params = brandFilter != null
                ? new Object[] { from.atDay(1), to.atDay(1), brandFilter }
                : new Object[] { from.atDay(1), to.atDay(1) };

        Map<String, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put((String) row.get("Channel"), total);
        }
        return totals;
    }

    // Real per-year targets (summed across that year's months) for every year in [fromYear, toYear]
    // — backs the Daily Trend Graph's target line/thread overlay in "By Year" mode.
    public Map<Integer, BigDecimal> getYearlyTargetsInRange(int fromYear, int toYear, String brandFilter) {
        String sql = "SELECT YEAR(Month) AS yr, SUM(Sales_Target) AS total FROM Primary_Sales_Target "
                + "WHERE YEAR(Month) BETWEEN ? AND ?"
                + (brandFilter != null ? " AND Brand = ?" : "")
                + " GROUP BY YEAR(Month)";
        Object[] params = brandFilter != null
                ? new Object[] { fromYear, toYear, brandFilter }
                : new Object[] { fromYear, toYear };

        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put(((Number) row.get("yr")).intValue(), total);
        }
        return totals;
    }
}
