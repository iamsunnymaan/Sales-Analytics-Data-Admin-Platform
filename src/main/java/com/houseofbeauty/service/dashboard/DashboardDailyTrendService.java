package com.houseofbeauty.service.dashboard;

import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.LocalDate;
import java.time.Year;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

// Backs the Dashboard page's "2. Daily Sales Trends" section — the only section on this page that
// represents BOTH sales channels together, per explicit request: Total Sales = Primary_Sales +
// Secondary_Sales, Total Target = Primary_Sales_Target + Secondary_Sales_Target, both summed
// directly per real Brand column. Primary_Sales.Brand/Secondary_Sales.Brand/
// Primary_Sales_Target.Brand/Secondary_Sales_Target.Brand all carry the SAME full-name vocabulary
// as Site_Master.Brand ("Anastasia Beverly hills"/"Kylie Cosmetics") via their own FK to
// site_master(Site_Code, Brand) — confirmed live against the DB — so a direct `Brand = ?` filter on
// each fact table already correctly attributes every row to a Brand with no Site_Master join
// needed. Exact mirror of SecondarySalesDailyTrendService's own day/month/year bucketing shape,
// just summing both tables at every step instead of one.
//
// Channel/Status (added so the "Filter Header" section's own Channel/Status pills can drive this
// chart too, same as they already drive "1. Overview"/"3. Partner Wise Target Vs Achievement"):
// unlike Brand, no fact/target table here carries Channel or Operational_Status as a direct column
// except Primary_Sales_Target's own Channel — Primary_Sales/Secondary_Sales/Secondary_Sales_Target
// all need a join back to Site_Master (on their own site-code column + Brand) to filter by either
// one, same per-table split DashboardOverviewService's own header comment describes. SalesTable/
// TargetTable below carry each table's own site-code column (null on Primary_Sales_Target, which
// needs no join for Channel but still does for Status, since Operational_Status lives only on
// Site_Master) so every query method below can add that join only when a Channel or Status filter is
// actually active.
@Service
public class DashboardDailyTrendService {

    private static final Set<String> VALID_GRANULARITIES = Set.of("day", "month", "year");
    private static final Set<String> VALID_SALES_TYPES = Set.of("all", "primary", "secondary");
    private static final int MAX_DAY_SPAN = 400;
    private static final int MAX_MONTH_SPAN = 600;
    private static final int MAX_YEAR_SPAN = 200;
    // 2-digit year ("1-Sep-26"), matching Secondary/Primary Sales/Site Status pages' own Daily Sales
    // Trends X-axis format for UI/UX parity across all four.
    private static final DateTimeFormatter DAY_LABEL_FORMAT = DateTimeFormatter.ofPattern("d-MMM-uu", Locale.ENGLISH);

    private final JdbcTemplate jdbcTemplate;

    public DashboardDailyTrendService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    // Distinct years with data across BOTH Primary_Sales and Secondary_Sales, plus the current year
    // — backs the Daily Sales Trends date filter's Year checkbox/dropdown list, same convention as
    // SecondarySalesYearTrendService/PrimarySalesYearTrendService's own listYears.
    public List<Integer> listYears() {
        TreeSet<Integer> years = new TreeSet<>();
        years.addAll(jdbcTemplate.queryForList("SELECT DISTINCT YEAR(Sales_Date) FROM Primary_Sales", Integer.class));
        years.addAll(jdbcTemplate.queryForList("SELECT DISTINCT YEAR(Sales_Date) FROM Secondary_Sales", Integer.class));
        years.add(Year.now().getValue());
        return new ArrayList<>(years);
    }

    // Real distinct Brand values Site_Master currently has — backs this page's Daily Sales Trends
    // brand pill, same query/convention every other page's own copy of this method uses.
    public List<String> getAvailableBrands() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master " +
                "WHERE Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> ''";
        TreeSet<String> brands = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String brand : jdbcTemplate.queryForList(sql, String.class)) {
            brands.add(brand.trim());
        }
        return new ArrayList<>(brands);
    }

    // table.siteCodeColumn() is the column this table joins to Site_Master(Site_Code) on when a
    // Channel and/or Status filter is active; null means Channel is already a direct column on the
    // table itself (only Primary_Sales_Target) — Status still needs the join even then, since
    // Operational_Status only ever lives on Site_Master.
    private record SalesTable(String name, String siteCodeColumn) {}
    private record TargetTable(String name, String siteCodeColumn) {}

    // Resolves the "Sales Type" filter (All/Primary Sales/Secondary Sales, see the frontend's own
    // #dailyTrendSalesTypeToggle) to the Sales fact table(s) each combined*TotalsInRange method
    // should sum — "all" (the always-default) keeps the original both-tables-combined behavior,
    // "primary"/"secondary" restrict to just that one channel.
    private List<SalesTable> salesTables(String salesType) {
        return switch (salesType) {
            case "primary" -> List.of(new SalesTable("Primary_Sales", "Bill_to"));
            case "secondary" -> List.of(new SalesTable("Secondary_Sales", "Site_Code"));
            default -> List.of(new SalesTable("Primary_Sales", "Bill_to"), new SalesTable("Secondary_Sales", "Site_Code"));
        };
    }

    // Same idea as salesTables, for the Target fact tables combined*TargetsInRange methods sum.
    private List<TargetTable> targetTables(String salesType) {
        return switch (salesType) {
            case "primary" -> List.of(new TargetTable("Primary_Sales_Target", null));
            case "secondary" -> List.of(new TargetTable("Secondary_Sales_Target", "Site_Code"));
            default -> List.of(new TargetTable("Primary_Sales_Target", null), new TargetTable("Secondary_Sales_Target", "Site_Code"));
        };
    }

    private Map<LocalDate, BigDecimal> combinedDayTotalsInRange(LocalDate from, LocalDate to, String brand, String salesType, String channel, String status) {
        Map<LocalDate, BigDecimal> totals = new HashMap<>();
        for (SalesTable table : salesTables(salesType)) {
            boolean needsJoin = channel != null || status != null;
            List<Object> params = new ArrayList<>(List.of(from, to));
            StringBuilder sql = new StringBuilder(
                    "SELECT CAST(t.Sales_Date AS DATE) AS d, SUM(t.Sales) AS total FROM " + table.name() + " t ");
            if (needsJoin) {
                sql.append("JOIN Site_Master sm ON sm.Site_Code = t.").append(table.siteCodeColumn()).append(" AND sm.Brand = t.Brand ");
            }
            sql.append("WHERE t.Sales_Date BETWEEN ? AND ? ");
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
            sql.append("GROUP BY CAST(t.Sales_Date AS DATE)");
            for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
                LocalDate date = ((Date) row.get("d")).toLocalDate();
                totals.merge(date, asDecimal(row.get("total")), BigDecimal::add);
            }
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> combinedMonthTotalsInRange(LocalDate from, LocalDate to, String brand, String salesType, String channel, String status) {
        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (SalesTable table : salesTables(salesType)) {
            boolean needsJoin = channel != null || status != null;
            List<Object> params = new ArrayList<>(List.of(from, to));
            StringBuilder sql = new StringBuilder(
                    "SELECT YEAR(t.Sales_Date) AS yr, MONTH(t.Sales_Date) AS mo, SUM(t.Sales) AS total FROM " + table.name() + " t ");
            if (needsJoin) {
                sql.append("JOIN Site_Master sm ON sm.Site_Code = t.").append(table.siteCodeColumn()).append(" AND sm.Brand = t.Brand ");
            }
            sql.append("WHERE t.Sales_Date BETWEEN ? AND ? ");
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
            sql.append("GROUP BY YEAR(t.Sales_Date), MONTH(t.Sales_Date)");
            for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
                YearMonth ym = YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue());
                totals.merge(ym, asDecimal(row.get("total")), BigDecimal::add);
            }
        }
        return totals;
    }

    private Map<Integer, BigDecimal> combinedYearTotalsInRange(LocalDate from, LocalDate to, String brand, String salesType, String channel, String status) {
        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (SalesTable table : salesTables(salesType)) {
            boolean needsJoin = channel != null || status != null;
            List<Object> params = new ArrayList<>(List.of(from, to));
            StringBuilder sql = new StringBuilder(
                    "SELECT YEAR(t.Sales_Date) AS yr, SUM(t.Sales) AS total FROM " + table.name() + " t ");
            if (needsJoin) {
                sql.append("JOIN Site_Master sm ON sm.Site_Code = t.").append(table.siteCodeColumn()).append(" AND sm.Brand = t.Brand ");
            }
            sql.append("WHERE t.Sales_Date BETWEEN ? AND ? ");
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
            sql.append("GROUP BY YEAR(t.Sales_Date)");
            for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
                int year = ((Number) row.get("yr")).intValue();
                totals.merge(year, asDecimal(row.get("total")), BigDecimal::add);
            }
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> combinedMonthlyTargetsInRange(YearMonth from, YearMonth to, String brand, String salesType, String channel, String status) {
        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (TargetTable table : targetTables(salesType)) {
            boolean needsJoin = (channel != null || status != null) && table.siteCodeColumn() != null;
            List<Object> params = new ArrayList<>(List.of(from.atDay(1), to.atEndOfMonth()));
            StringBuilder sql = new StringBuilder(
                    "SELECT YEAR(t.Month) AS yr, MONTH(t.Month) AS mo, SUM(t.Sales_Target) AS total FROM " + table.name() + " t ");
            if (needsJoin) {
                sql.append("JOIN Site_Master sm ON sm.Site_Code = t.").append(table.siteCodeColumn()).append(" AND sm.Brand = t.Brand ");
            }
            sql.append("WHERE t.Month BETWEEN ? AND ? ");
            if (brand != null) {
                sql.append("AND t.Brand = ? ");
                params.add(brand);
            }
            if (channel != null) {
                sql.append(needsJoin ? "AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) " : "AND LOWER(LTRIM(RTRIM(t.Channel))) = LOWER(?) ");
                params.add(channel);
            }
            if (status != null && needsJoin) {
                sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
            }
            sql.append("GROUP BY YEAR(t.Month), MONTH(t.Month)");
            for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
                YearMonth ym = YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue());
                totals.merge(ym, asDecimal(row.get("total")), BigDecimal::add);
            }
        }
        return totals;
    }

    private Map<Integer, BigDecimal> combinedYearlyTargetsInRange(int fromYear, int toYear, String brand, String salesType, String channel, String status) {
        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (TargetTable table : targetTables(salesType)) {
            boolean needsJoin = (channel != null || status != null) && table.siteCodeColumn() != null;
            List<Object> params = new ArrayList<>(List.of(fromYear, toYear));
            StringBuilder sql = new StringBuilder(
                    "SELECT YEAR(t.Month) AS yr, SUM(t.Sales_Target) AS total FROM " + table.name() + " t ");
            if (needsJoin) {
                sql.append("JOIN Site_Master sm ON sm.Site_Code = t.").append(table.siteCodeColumn()).append(" AND sm.Brand = t.Brand ");
            }
            sql.append("WHERE YEAR(t.Month) BETWEEN ? AND ? ");
            if (brand != null) {
                sql.append("AND t.Brand = ? ");
                params.add(brand);
            }
            if (channel != null) {
                sql.append(needsJoin ? "AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(?) " : "AND LOWER(LTRIM(RTRIM(t.Channel))) = LOWER(?) ");
                params.add(channel);
            }
            if (status != null && needsJoin) {
                sql.append(OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
            }
            sql.append("GROUP BY YEAR(t.Month)");
            for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
                int year = ((Number) row.get("yr")).intValue();
                totals.merge(year, asDecimal(row.get("total")), BigDecimal::add);
            }
        }
        return totals;
    }

    private record TrendSeries(List<String> labels, List<String> dates, List<BigDecimal> data,
                                List<BigDecimal> target, List<BigDecimal> lastYear) {
    }

    private void validateSpan(LocalDate from, LocalDate to, String granularity) {
        switch (granularity) {
            case "month" -> {
                long months = ChronoUnit.MONTHS.between(YearMonth.from(from), YearMonth.from(to));
                if (months > MAX_MONTH_SPAN) {
                    throw new IllegalArgumentException("Date range too wide for month granularity: max " + MAX_MONTH_SPAN + " months");
                }
            }
            case "year" -> {
                if (to.getYear() - from.getYear() > MAX_YEAR_SPAN) {
                    throw new IllegalArgumentException("Date range too wide for year granularity: max " + MAX_YEAR_SPAN + " years");
                }
            }
            default -> {
                long days = ChronoUnit.DAYS.between(from, to);
                if (days > MAX_DAY_SPAN) {
                    throw new IllegalArgumentException("Date range too wide for day granularity: max " + MAX_DAY_SPAN + " days");
                }
            }
        }
    }

    private TrendSeries buildDayRangeView(LocalDate from, LocalDate to, String brand, String salesType, String channel, String status) {
        Map<LocalDate, BigDecimal> totals = combinedDayTotalsInRange(from, to, brand, salesType, channel, status);
        Map<LocalDate, BigDecimal> lastYearTotals = combinedDayTotalsInRange(from.minusYears(1), to.minusYears(1), brand, salesType, channel, status);
        Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargetsInRange(YearMonth.from(from), YearMonth.from(to), brand, salesType, channel, status);

        List<String> labels = new ArrayList<>();
        List<String> dates = new ArrayList<>();
        List<BigDecimal> data = new ArrayList<>();
        List<BigDecimal> target = new ArrayList<>();
        List<BigDecimal> lastYear = new ArrayList<>();
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            labels.add(date.format(DAY_LABEL_FORMAT));
            dates.add(date.toString());
            data.add(totals.getOrDefault(date, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            YearMonth ym = YearMonth.from(date);
            BigDecimal monthlyTarget = monthlyTargets.getOrDefault(ym, BigDecimal.ZERO);
            target.add(monthlyTarget.divide(BigDecimal.valueOf(ym.lengthOfMonth()), 2, RoundingMode.HALF_UP));
            lastYear.add(lastYearTotals.getOrDefault(date.minusYears(1), BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
        }
        return new TrendSeries(labels, dates, data, target, lastYear);
    }

    private TrendSeries buildMonthRangeView(LocalDate from, LocalDate to, String brand, String salesType, String channel, String status) {
        Map<YearMonth, BigDecimal> totals = combinedMonthTotalsInRange(from, to, brand, salesType, channel, status);
        Map<YearMonth, BigDecimal> lastYearTotals = combinedMonthTotalsInRange(from.minusYears(1), to.minusYears(1), brand, salesType, channel, status);

        YearMonth end = YearMonth.from(to);
        YearMonth start = YearMonth.from(from);
        Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargetsInRange(start, end, brand, salesType, channel, status);

        List<String> labels = new ArrayList<>();
        List<String> dates = new ArrayList<>();
        List<BigDecimal> data = new ArrayList<>();
        List<BigDecimal> target = new ArrayList<>();
        List<BigDecimal> lastYear = new ArrayList<>();
        for (YearMonth ym = start; !ym.isAfter(end); ym = ym.plusMonths(1)) {
            String monthLabel = ym.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
            labels.add(monthLabel + " " + ym.getYear());
            dates.add(ym.toString());
            data.add(totals.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            target.add(monthlyTargets.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            lastYear.add(lastYearTotals.getOrDefault(ym.minusYears(1), BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
        }
        return new TrendSeries(labels, dates, data, target, lastYear);
    }

    private TrendSeries buildYearRangeView(LocalDate from, LocalDate to, String brand, String salesType, String channel, String status) {
        Map<Integer, BigDecimal> totals = combinedYearTotalsInRange(from, to, brand, salesType, channel, status);
        Map<Integer, BigDecimal> lastYearTotals = combinedYearTotalsInRange(from.minusYears(1), to.minusYears(1), brand, salesType, channel, status);
        Map<Integer, BigDecimal> yearlyTargets = combinedYearlyTargetsInRange(from.getYear(), to.getYear(), brand, salesType, channel, status);

        List<String> labels = new ArrayList<>();
        List<String> dates = new ArrayList<>();
        List<BigDecimal> data = new ArrayList<>();
        List<BigDecimal> target = new ArrayList<>();
        List<BigDecimal> lastYear = new ArrayList<>();
        for (int year = from.getYear(); year <= to.getYear(); year++) {
            labels.add(String.valueOf(year));
            dates.add(String.valueOf(year));
            data.add(totals.getOrDefault(year, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            target.add(yearlyTargets.getOrDefault(year, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            lastYear.add(lastYearTotals.getOrDefault(year - 1, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
        }
        return new TrendSeries(labels, dates, data, target, lastYear);
    }

    // "all"/blank/null all mean "no Channel filter" — same convention DashboardController's own
    // resolveChannel uses for the Overview endpoints, kept here (rather than resolved by the
    // controller) so this method stays self-contained the same way it already resolves brand/
    // salesType itself instead of trusting a pre-resolved caller.
    private String resolveChannel(String channel) {
        return (channel == null || channel.isBlank() || "all".equalsIgnoreCase(channel)) ? null : channel.trim();
    }

    // "all"/blank/null all mean "no Status filter" — OperationalStatusFilter.whereClause itself
    // already treats any other unrecognized value as "no filter" too, so this just normalizes the
    // "skip the join entirely" case the same way resolveChannel above does.
    private String resolveStatus(String status) {
        return (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) ? null : status.trim();
    }

    public Map<String, Object> getTrendRange(LocalDate from, LocalDate to, String granularity, String brand, String salesType, String channel, String status) {
        String normalizedBrand = BrandFilter.normalize(brand);
        String brandFilter = BrandFilter.product(normalizedBrand);
        String channelFilter = resolveChannel(channel);
        String statusFilter = resolveStatus(status);

        String normalizedGranularity = granularity == null ? "day" : granularity.toLowerCase();
        if (!VALID_GRANULARITIES.contains(normalizedGranularity)) {
            throw new IllegalArgumentException("Invalid granularity: must be one of " + VALID_GRANULARITIES);
        }

        // "Sales Type" filter — All (default)/Primary Sales/Secondary Sales, see this page's own
        // #dailyTrendSalesTypeToggle. Restricts salesTables()/targetTables() below to just the one
        // picked channel; "all" keeps the section's original both-channels-combined behavior.
        String normalizedSalesType = salesType == null ? "all" : salesType.toLowerCase();
        if (!VALID_SALES_TYPES.contains(normalizedSalesType)) {
            throw new IllegalArgumentException("Invalid salesType: must be one of " + VALID_SALES_TYPES);
        }

        LocalDate periodFrom = from;
        LocalDate periodTo = to;
        if (periodFrom == null || periodTo == null) {
            YearMonth currentMonth = YearMonth.now();
            periodFrom = currentMonth.atDay(1);
            periodTo = currentMonth.atEndOfMonth();
        } else if (periodFrom.isAfter(periodTo)) {
            LocalDate swap = periodFrom;
            periodFrom = periodTo;
            periodTo = swap;
        }
        validateSpan(periodFrom, periodTo, normalizedGranularity);

        TrendSeries series = switch (normalizedGranularity) {
            case "month" -> buildMonthRangeView(periodFrom, periodTo, brandFilter, normalizedSalesType, channelFilter, statusFilter);
            case "year" -> buildYearRangeView(periodFrom, periodTo, brandFilter, normalizedSalesType, channelFilter, statusFilter);
            default -> buildDayRangeView(periodFrom, periodTo, brandFilter, normalizedSalesType, channelFilter, statusFilter);
        };

        Map<String, Object> period = new LinkedHashMap<>();
        period.put("from", periodFrom.toString());
        period.put("to", periodTo.toString());

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("granularity", normalizedGranularity);
        response.put("brand", normalizedBrand);
        response.put("salesType", normalizedSalesType);
        response.put("channel", channelFilter == null ? "all" : channelFilter);
        response.put("status", statusFilter == null ? "all" : statusFilter);
        response.put("period", period);
        response.put("labels", series.labels());
        response.put("dates", series.dates());
        response.put("data", series.data());
        response.put("target", series.target());
        response.put("lastYear", series.lastYear());
        return response;
    }
}
