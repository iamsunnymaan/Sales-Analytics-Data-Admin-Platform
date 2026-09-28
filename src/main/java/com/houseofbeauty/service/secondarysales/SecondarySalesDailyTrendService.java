package com.houseofbeauty.service.secondarysales;

import com.houseofbeauty.dto.secondarysales.response.TrendPeriod;
import com.houseofbeauty.dto.secondarysales.response.TrendRangeResponse;
import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.ChannelFilter;
import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class SecondarySalesDailyTrendService {

    private static final Set<String> VALID_GRANULARITIES = Set.of("day", "month", "year");
    private static final int MAX_DAY_SPAN = 400;
    private static final int MAX_MONTH_SPAN = 600;
    private static final int MAX_YEAR_SPAN = 200;

    private static final DateTimeFormatter DAY_LABEL_FORMAT = DateTimeFormatter.ofPattern("d-MMM-uu", Locale.ENGLISH);

    private final JdbcTemplate jdbcTemplate;
    private final SecondarySalesTargetService secondarySalesTargetService;

    public SecondarySalesDailyTrendService(JdbcTemplate jdbcTemplate, SecondarySalesTargetService secondarySalesTargetService) {
        this.jdbcTemplate = jdbcTemplate;
        this.secondarySalesTargetService = secondarySalesTargetService;
    }

    private BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    public List<String> getAvailableBrands() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master " +
                "WHERE Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> ''";
        java.util.Set<String> brands = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            brands.add(((String) row.get("Brand")).trim());
        }
        return new ArrayList<>(brands);
    }

    private List<String> resolveSiteCodesForChannelAndStatus(String channelFilter, String status) {
        String statusClause = OperationalStatusFilter.whereClause(status);
        if (channelFilter == null && statusClause.isEmpty()) {
            return null;
        }
        StringBuilder sql = new StringBuilder("SELECT DISTINCT Site_Code FROM Site_Master WHERE Sales_Type = 'Secondary Sales' ");
        List<Object> params = new ArrayList<>();
        if (channelFilter != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(?) ");
            params.add(channelFilter);
        }
        sql.append(statusClause);
        return jdbcTemplate.queryForList(sql.toString(), String.class, params.toArray());
    }

    private void appendSiteCodeFilter(StringBuilder sql, List<Object> params, List<String> siteCodes) {
        if (siteCodes == null) {
            return;
        }
        if (siteCodes.isEmpty()) {
            sql.append("AND 1 = 0 ");
            return;
        }
        sql.append("AND ss.Site_Code IN (")
                .append(siteCodes.stream().map(c -> "?").collect(Collectors.joining(",")))
                .append(") ");
        params.addAll(siteCodes);
    }

    public TrendRangeResponse getTrendRange(LocalDate from, LocalDate to, String granularity, String brand, String channel, String status) {
        String normalizedBrand = BrandFilter.normalize(brand);

        String brandFilter = BrandFilter.product(normalizedBrand);
        List<String> siteCodes = resolveSiteCodesForChannelAndStatus(ChannelFilter.normalize(channel), status);

        String normalizedGranularity = granularity == null ? "day" : granularity.toLowerCase();
        if (!VALID_GRANULARITIES.contains(normalizedGranularity)) {
            throw new IllegalArgumentException("Invalid granularity: must be one of " + VALID_GRANULARITIES);
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
            case "month" -> buildMonthRangeView(periodFrom, periodTo, brandFilter, siteCodes);
            case "year" -> buildYearRangeView(periodFrom, periodTo, brandFilter, siteCodes);
            default -> buildDayRangeView(periodFrom, periodTo, brandFilter, siteCodes);
        };

        return new TrendRangeResponse(normalizedGranularity, normalizedBrand,
                new TrendPeriod(periodFrom.toString(), periodTo.toString()), series.labels(), series.dates(),
                series.data(), series.target(), series.lastYear());
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

    private Map<LocalDate, BigDecimal> dayTotalsInRange(LocalDate from, LocalDate to, String brand, List<String> siteCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT CAST(ss.Sales_Date AS DATE) AS d, SUM(ss.Sales) AS total FROM Secondary_Sales ss ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ss.Article_Code ");
        }
        sql.append("WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append("GROUP BY CAST(ss.Sales_Date AS DATE)");

        Map<LocalDate, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(((Date) row.get("d")).toLocalDate(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> monthTotalsInRange(LocalDate from, LocalDate to, String brand, List<String> siteCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(ss.Sales_Date) AS yr, MONTH(ss.Sales_Date) AS mo, SUM(ss.Sales) AS total FROM Secondary_Sales ss ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ss.Article_Code ");
        }
        sql.append("WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append("GROUP BY YEAR(ss.Sales_Date), MONTH(ss.Sales_Date)");

        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            int yr = ((Number) row.get("yr")).intValue();
            int mo = ((Number) row.get("mo")).intValue();
            totals.put(YearMonth.of(yr, mo), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<Integer, BigDecimal> yearTotalsInRange(LocalDate from, LocalDate to, String brand, List<String> siteCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(ss.Sales_Date) AS yr, SUM(ss.Sales) AS total FROM Secondary_Sales ss ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ss.Article_Code ");
        }
        sql.append("WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append("GROUP BY YEAR(ss.Sales_Date)");

        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(((Number) row.get("yr")).intValue(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private TrendSeries buildDayRangeView(LocalDate from, LocalDate to, String brand, List<String> siteCodes) {
        Map<LocalDate, BigDecimal> totals = dayTotalsInRange(from, to, brand, siteCodes);
        Map<LocalDate, BigDecimal> lastYearTotals = dayTotalsInRange(from.minusYears(1), to.minusYears(1), brand, siteCodes);

        Map<YearMonth, BigDecimal> monthlyTargets = secondarySalesTargetService.getMonthlyTargetsInRange(
                YearMonth.from(from), YearMonth.from(to), brand, siteCodes);

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

    private TrendSeries buildMonthRangeView(LocalDate from, LocalDate to, String brand, List<String> siteCodes) {
        Map<YearMonth, BigDecimal> totals = monthTotalsInRange(from, to, brand, siteCodes);
        Map<YearMonth, BigDecimal> lastYearTotals = monthTotalsInRange(from.minusYears(1), to.minusYears(1), brand, siteCodes);

        YearMonth end = YearMonth.from(to);
        YearMonth start = YearMonth.from(from);
        Map<YearMonth, BigDecimal> monthlyTargets = secondarySalesTargetService.getMonthlyTargetsInRange(start, end, brand, siteCodes);

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

    private TrendSeries buildYearRangeView(LocalDate from, LocalDate to, String brand, List<String> siteCodes) {
        Map<Integer, BigDecimal> totals = yearTotalsInRange(from, to, brand, siteCodes);
        Map<Integer, BigDecimal> lastYearTotals = yearTotalsInRange(from.minusYears(1), to.minusYears(1), brand, siteCodes);

        Map<Integer, BigDecimal> yearlyTargets = secondarySalesTargetService.getYearlyTargetsInRange(from.getYear(), to.getYear(), brand, siteCodes);

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
}
