package com.houseofbeauty.service.primarysales;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.Map;

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
