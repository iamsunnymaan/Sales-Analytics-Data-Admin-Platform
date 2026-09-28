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

    public List<String> getAvailableSalesTypes() {
        String sql = "SELECT DISTINCT Sales_Type FROM Site_Master WHERE Sales_Type IS NOT NULL AND LTRIM(RTRIM(Sales_Type)) <> ''";
        TreeSet<String> types = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String type : jdbcTemplate.queryForList(sql, String.class)) {
            types.add(type.trim());
        }
        return new ArrayList<>(types);
    }

    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM Site_Master", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

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

    private void mergeAdd(Map<String, BigDecimal> into, Map<String, BigDecimal> from) {
        from.forEach((partner, value) -> into.merge(partner, value, BigDecimal::add));
    }

    private void collectPartnerTotals(Map<String, BigDecimal> totals, String sql, Object... params) {
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params)) {
            Object partner = row.get("partner");
            if (partner == null) {
                continue;
            }
            totals.merge(TextMatch.normalize(partner.toString()), asDecimal(row.get("total")), BigDecimal::add);
        }
    }

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
