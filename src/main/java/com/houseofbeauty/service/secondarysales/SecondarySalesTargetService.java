package com.houseofbeauty.service.secondarysales;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class SecondarySalesTargetService {

    private final JdbcTemplate jdbcTemplate;

    public SecondarySalesTargetService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private void appendSiteCodeFilter(StringBuilder sql, List<Object> params, List<String> siteCodes) {
        if (siteCodes == null) {
            return;
        }
        if (siteCodes.isEmpty()) {
            sql.append(" AND 1 = 0");
            return;
        }
        sql.append(" AND Site_Code IN (")
                .append(siteCodes.stream().map(c -> "?").collect(Collectors.joining(",")))
                .append(")");
        params.addAll(siteCodes);
    }

    public Map<YearMonth, BigDecimal> getMonthlyTargetsInRange(YearMonth from, YearMonth to, String brandFilter, List<String> siteCodes) {
        List<Object> params = new ArrayList<>(List.of(from.atDay(1), to.atEndOfMonth()));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(Month) AS yr, MONTH(Month) AS mo, SUM(Sales_Target) AS total FROM Secondary_Sales_Target "
                        + "WHERE Month BETWEEN ? AND ?");
        if (brandFilter != null) {
            sql.append(" AND Brand = ?");
            params.add(brandFilter);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append(" GROUP BY YEAR(Month), MONTH(Month)");

        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put(YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue()), total);
        }
        return totals;
    }

    public Map<Integer, BigDecimal> getYearlyTargetsInRange(int fromYear, int toYear, String brandFilter, List<String> siteCodes) {
        List<Object> params = new ArrayList<>(List.of(fromYear, toYear));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(Month) AS yr, SUM(Sales_Target) AS total FROM Secondary_Sales_Target "
                        + "WHERE YEAR(Month) BETWEEN ? AND ?");
        if (brandFilter != null) {
            sql.append(" AND Brand = ?");
            params.add(brandFilter);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append(" GROUP BY YEAR(Month)");

        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put(((Number) row.get("yr")).intValue(), total);
        }
        return totals;
    }
}
