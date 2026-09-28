package com.houseofbeauty.service.sitedetail;

import com.houseofbeauty.util.SqlDialect;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
public class SiteDetailService {

    private static final int TRANSACTIONS_LIMIT = 200;

    private final JdbcTemplate jdbcTemplate;
    private final SqlDialect dialect;

    public SiteDetailService(JdbcTemplate jdbcTemplate, SqlDialect dialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.dialect = dialect;
    }

    public Map<String, Object> getSiteDetail(String siteCode, String brand) {
        Map<String, Object> profile = loadProfile(siteCode, brand);
        Map<String, Object> result = new LinkedHashMap<>();
        if (profile == null) {
            result.put("found", false);
            return result;
        }
        result.put("found", true);
        result.put("profile", profile);
        result.put("kpis", loadKpis(siteCode, brand, profile));
        result.put("monthlyHistory", loadMonthlyHistory(siteCode, brand, profile));
        result.put("primaryTransactions", loadPrimaryTransactions(siteCode, brand));
        result.put("secondaryTransactions", loadSecondaryTransactions(siteCode, brand));
        return result;
    }

    private Map<String, Object> loadProfile(String siteCode, String brand) {
        String sql = "SELECT Site_Code, Brand, Store_Name, City, State, Region, Channel, Sub_Channel, " +
                "Partner, RM, AM, CM, SM, Opening_Date, Operational_Status, Sales_Type FROM site_master " +
                "WHERE Site_Code = ? AND Brand = ?";
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, siteCode, brand);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private Map<String, Object> loadKpis(String siteCode, String brand, Map<String, Object> profile) {
        Map<String, Object> primary = jdbcTemplate.queryForMap(
                "SELECT COALESCE(SUM(Sales), 0) AS totalSales, COUNT(*) AS txnCount FROM Primary_Sales " +
                        "WHERE Bill_to = ? AND Brand = ?", siteCode, brand);
        Map<String, Object> secondary = jdbcTemplate.queryForMap(
                "SELECT COALESCE(SUM(Sales), 0) AS totalSales, COUNT(*) AS txnCount FROM Secondary_Sales " +
                        "WHERE Site_Code = ? AND Brand = ?", siteCode, brand);

        BigDecimal primaryAllTime = asDecimal(primary.get("totalSales"));
        BigDecimal secondaryAllTime = asDecimal(secondary.get("totalSales"));

        Date primaryMinDate = jdbcTemplate.queryForObject(
                "SELECT MIN(Sales_Date) FROM Primary_Sales WHERE Bill_to = ? AND Brand = ?", Date.class, siteCode, brand);
        Date secondaryMinDate = jdbcTemplate.queryForObject(
                "SELECT MIN(Sales_Date) FROM Secondary_Sales WHERE Site_Code = ? AND Brand = ?", Date.class, siteCode, brand);
        LocalDate earliestSalesMonth = earliestOf(primaryMinDate, secondaryMinDate);

        String channel = (String) profile.get("Channel");
        String partner = (String) profile.get("Partner");
        BigDecimal primaryTargetAllTime = (channel == null || partner == null) ? BigDecimal.ZERO
                : asDecimal(jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(Sales_Target), 0) FROM Primary_Sales_Target WHERE Brand = ? " +
                        "AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(LTRIM(RTRIM(?))) AND LOWER(LTRIM(RTRIM(Partner))) = LOWER(LTRIM(RTRIM(?)))",
                BigDecimal.class, brand, channel, partner));
        BigDecimal secondaryTargetAllTime = asDecimal(jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(Sales_Target), 0) FROM Secondary_Sales_Target WHERE Site_Code = ? AND Brand = ?",
                BigDecimal.class, siteCode, brand));
        BigDecimal totalTargetAllTime = primaryTargetAllTime.add(secondaryTargetAllTime);
        BigDecimal totalSalesAllTime = primaryAllTime.add(secondaryAllTime);

        BigDecimal totalAchievementPct = achievementPct(totalSalesAllTime, totalTargetAllTime);

        LocalDate now = LocalDate.now();
        LocalDate previousMonth = now.minusMonths(1);
        LocalDate lastYearSameMonth = now.minusYears(1);

        BigDecimal currentMonthSales = monthSales(siteCode, brand, now);
        BigDecimal currentMonthTarget = monthTarget(siteCode, brand, channel, partner, now);
        BigDecimal currentMonthAchievementPct = achievementPct(currentMonthSales, currentMonthTarget);

        BigDecimal previousMonthSales = monthSales(siteCode, brand, previousMonth);
        BigDecimal previousMonthTarget = monthTarget(siteCode, brand, channel, partner, previousMonth);
        BigDecimal previousMonthAchievementPct = achievementPct(previousMonthSales, previousMonthTarget);

        BigDecimal lastYearSameMonthSales = monthSales(siteCode, brand, lastYearSameMonth);
        BigDecimal lastYearSameMonthTarget = monthTarget(siteCode, brand, channel, partner, lastYearSameMonth);
        BigDecimal lastYearSameMonthAchievementPct = achievementPct(lastYearSameMonthSales, lastYearSameMonthTarget);

        Map<String, Object> kpis = new LinkedHashMap<>();
        kpis.put("primarySalesAllTime", primaryAllTime);
        kpis.put("secondarySalesAllTime", secondaryAllTime);
        kpis.put("primaryTransactionCount", asInt(primary.get("txnCount")));
        kpis.put("secondaryTransactionCount", asInt(secondary.get("txnCount")));
        kpis.put("totalSalesAllTime", totalSalesAllTime);
        kpis.put("totalSalesFromMonth", earliestSalesMonth == null ? null : earliestSalesMonth.toString());
        kpis.put("totalTargetAllTime", totalTargetAllTime);
        kpis.put("totalAchievementPct", totalAchievementPct);
        kpis.put("currentMonthTarget", currentMonthTarget);
        kpis.put("currentMonthAchievementPct", currentMonthAchievementPct);
        kpis.put("currentMonthSales", currentMonthSales);
        kpis.put("previousMonthTarget", previousMonthTarget);
        kpis.put("previousMonthAchievementPct", previousMonthAchievementPct);
        kpis.put("previousMonthSales", previousMonthSales);
        kpis.put("lastYearSameMonthTarget", lastYearSameMonthTarget);
        kpis.put("lastYearSameMonthAchievementPct", lastYearSameMonthAchievementPct);
        kpis.put("lastYearSameMonthSales", lastYearSameMonthSales);
        return kpis;
    }

    private BigDecimal monthSales(String siteCode, String brand, LocalDate month) {
        BigDecimal primary = asDecimal(jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(Sales), 0) FROM Primary_Sales WHERE Bill_to = ? AND Brand = ? " +
                        "AND YEAR(Sales_Date) = ? AND MONTH(Sales_Date) = ?",
                BigDecimal.class, siteCode, brand, month.getYear(), month.getMonthValue()));
        BigDecimal secondary = asDecimal(jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(Sales), 0) FROM Secondary_Sales WHERE Site_Code = ? AND Brand = ? " +
                        "AND YEAR(Sales_Date) = ? AND MONTH(Sales_Date) = ?",
                BigDecimal.class, siteCode, brand, month.getYear(), month.getMonthValue()));
        return primary.add(secondary);
    }

    private BigDecimal monthTarget(String siteCode, String brand, String channel, String partner, LocalDate month) {
        BigDecimal primaryTarget = (channel == null || partner == null) ? BigDecimal.ZERO
                : asDecimal(jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(Sales_Target), 0) FROM Primary_Sales_Target WHERE Brand = ? " +
                        "AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(LTRIM(RTRIM(?))) AND LOWER(LTRIM(RTRIM(Partner))) = LOWER(LTRIM(RTRIM(?))) " +
                        "AND YEAR(Month) = ? AND MONTH(Month) = ?",
                BigDecimal.class, brand, channel, partner, month.getYear(), month.getMonthValue()));
        BigDecimal secondaryTarget = asDecimal(jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(Sales_Target), 0) FROM Secondary_Sales_Target WHERE Site_Code = ? AND Brand = ? " +
                        "AND YEAR(Month) = ? AND MONTH(Month) = ?",
                BigDecimal.class, siteCode, brand, month.getYear(), month.getMonthValue()));
        return primaryTarget.add(secondaryTarget);
    }

    private static BigDecimal achievementPct(BigDecimal sales, BigDecimal target) {
        return target.compareTo(BigDecimal.ZERO) > 0
                ? sales.multiply(BigDecimal.valueOf(100)).divide(target, 1, RoundingMode.HALF_UP)
                : null;
    }

    private static LocalDate earliestOf(Date a, Date b) {
        LocalDate la = a == null ? null : a.toLocalDate();
        LocalDate lb = b == null ? null : b.toLocalDate();
        if (la == null) return lb;
        if (lb == null) return la;
        return la.isBefore(lb) ? la : lb;
    }

    private List<Map<String, Object>> loadMonthlyHistory(String siteCode, String brand, Map<String, Object> profile) {
        Map<LocalDate, BigDecimal> primarySales = loadMonthlySum(
                "SELECT DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1) AS ym, SUM(Sales) AS total " +
                        "FROM Primary_Sales WHERE Bill_to = ? AND Brand = ? GROUP BY DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1)",
                siteCode, brand);
        Map<LocalDate, BigDecimal> secondarySales = loadMonthlySum(
                "SELECT DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1) AS ym, SUM(Sales) AS total " +
                        "FROM Secondary_Sales WHERE Site_Code = ? AND Brand = ? GROUP BY DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1)",
                siteCode, brand);
        Map<LocalDate, BigDecimal> primaryQty = loadMonthlySum(
                "SELECT DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1) AS ym, SUM(Qty) AS total " +
                        "FROM Primary_Sales WHERE Bill_to = ? AND Brand = ? GROUP BY DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1)",
                siteCode, brand);
        Map<LocalDate, BigDecimal> secondaryQty = loadMonthlySum(
                "SELECT DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1) AS ym, SUM(Qty) AS total " +
                        "FROM Secondary_Sales WHERE Site_Code = ? AND Brand = ? GROUP BY DATEFROMPARTS(YEAR(Sales_Date), MONTH(Sales_Date), 1)",
                siteCode, brand);

        String channel = (String) profile.get("Channel");
        String partner = (String) profile.get("Partner");
        Map<LocalDate, BigDecimal> primaryTarget = (channel == null || partner == null)
                ? Map.of()
                : loadMonthlySum(
                "SELECT Month AS ym, SUM(Sales_Target) AS total FROM Primary_Sales_Target " +
                        "WHERE Brand = ? AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(LTRIM(RTRIM(?))) " +
                        "AND LOWER(LTRIM(RTRIM(Partner))) = LOWER(LTRIM(RTRIM(?))) GROUP BY Month",
                brand, channel, partner);
        Map<LocalDate, BigDecimal> secondaryTarget = loadMonthlySum(
                "SELECT Month AS ym, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                        "WHERE Site_Code = ? AND Brand = ? GROUP BY Month",
                siteCode, brand);

        TreeMap<LocalDate, Boolean> months = new TreeMap<>(Comparator.reverseOrder());
        primarySales.keySet().forEach(m -> months.put(m, true));
        secondarySales.keySet().forEach(m -> months.put(m, true));
        primaryTarget.keySet().forEach(m -> months.put(m, true));
        secondaryTarget.keySet().forEach(m -> months.put(m, true));

        List<Map<String, Object>> rows = new ArrayList<>();
        for (LocalDate month : months.keySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("month", month.toString());
            row.put("primarySales", primarySales.getOrDefault(month, BigDecimal.ZERO));
            row.put("primaryTarget", primaryTarget.get(month));
            row.put("primaryQty", primaryQty.getOrDefault(month, BigDecimal.ZERO));
            row.put("secondarySales", secondarySales.getOrDefault(month, BigDecimal.ZERO));
            row.put("secondaryTarget", secondaryTarget.get(month));
            row.put("secondaryQty", secondaryQty.getOrDefault(month, BigDecimal.ZERO));
            rows.add(row);
        }
        return rows;
    }

    private Map<LocalDate, BigDecimal> loadMonthlySum(String sql, Object... params) {
        Map<LocalDate, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            Date ym = (Date) row.get("ym");
            if (ym == null) continue;
            result.put(ym.toLocalDate(), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, Object> loadPrimaryTransactions(String siteCode, String brand) {
        return getPrimaryTransactions(siteCode, brand, TRANSACTIONS_LIMIT);
    }

    private Map<String, Object> loadSecondaryTransactions(String siteCode, String brand) {
        return getSecondaryTransactions(siteCode, brand, TRANSACTIONS_LIMIT);
    }

    public Map<String, Object> getPrimaryTransactions(String siteCode, String brand, int limit) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT " + dialect.topPrefix(limit) + "ps.Sales_Date, ps.Article_Code, pm.Description, " +
                        "ps.Qty, ps.MRP, ps.Sales FROM Primary_Sales ps " +
                        "LEFT JOIN Product_Master pm ON pm.Article_Code = ps.Article_Code " +
                        "WHERE ps.Bill_to = ? AND ps.Brand = ? ORDER BY ps.Sales_Date DESC, ps.SN DESC" + dialect.limitSuffix(limit),
                siteCode, brand);
        int totalCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM Primary_Sales WHERE Bill_to = ? AND Brand = ?",
                Integer.class, siteCode, brand);
        return transactionsResult(rows, totalCount);
    }

    public Map<String, Object> getSecondaryTransactions(String siteCode, String brand, int limit) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT " + dialect.topPrefix(limit) + "ss.Sales_Date, ss.Article_Code, pm.Description, " +
                        "ss.Qty, ss.MRP, ss.Sales FROM Secondary_Sales ss " +
                        "LEFT JOIN Product_Master pm ON pm.Article_Code = ss.Article_Code " +
                        "WHERE ss.Site_Code = ? AND ss.Brand = ? ORDER BY ss.Sales_Date DESC, ss.SN DESC" + dialect.limitSuffix(limit),
                siteCode, brand);
        int totalCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM Secondary_Sales WHERE Site_Code = ? AND Brand = ?",
                Integer.class, siteCode, brand);
        return transactionsResult(rows, totalCount);
    }

    private Map<String, Object> transactionsResult(List<Map<String, Object>> rows, int totalCount) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rows", rows);
        result.put("totalCount", totalCount);
        return result;
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal bd) return bd;
        if (value == null) return BigDecimal.ZERO;
        return new BigDecimal(value.toString());
    }

    private static int asInt(Object value) {
        if (value instanceof Number n) return n.intValue();
        return value == null ? 0 : Integer.parseInt(value.toString());
    }
}
