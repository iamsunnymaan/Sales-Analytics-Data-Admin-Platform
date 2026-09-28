package com.houseofbeauty.service.primarysales;

import com.houseofbeauty.dto.primarysales.response.TrendPeriod;
import com.houseofbeauty.dto.primarysales.response.TrendRangeResponse;
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

@Service
public class PrimarySalesDailyTrendService {

    private static final Set<String> VALID_GRANULARITIES = Set.of("day", "month", "year");

    private static final int MAX_DAY_SPAN = 400;
    private static final int MAX_MONTH_SPAN = 600;
    private static final int MAX_YEAR_SPAN = 200;

    private static final DateTimeFormatter DAY_LABEL_FORMAT = DateTimeFormatter.ofPattern("d-MMM-uu", Locale.ENGLISH);

    private final JdbcTemplate jdbcTemplate;
    private final PrimarySalesTargetService primarySalesTargetService;

    public PrimarySalesDailyTrendService(JdbcTemplate jdbcTemplate, PrimarySalesTargetService primarySalesTargetService) {
        this.jdbcTemplate = jdbcTemplate;
        this.primarySalesTargetService = primarySalesTargetService;
    }

    private BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    public TrendRangeResponse getTrendRange(LocalDate from, LocalDate to, String granularity, String brand, String channel, String status) {
        String normalizedBrand = BrandFilter.normalize(brand);

        String brandFilter = BrandFilter.product(normalizedBrand);

        List<String> billToCodes = resolveBillToCodesForChannelAndStatus(ChannelFilter.normalize(channel), status);

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
            case "month" -> buildMonthRangeView(periodFrom, periodTo, brandFilter, billToCodes);
            case "year" -> buildYearRangeView(periodFrom, periodTo, brandFilter, billToCodes);
            default -> buildDayRangeView(periodFrom, periodTo, brandFilter, billToCodes);
        };

        return new TrendRangeResponse(normalizedGranularity, normalizedBrand,
                new TrendPeriod(periodFrom.toString(), periodTo.toString()), series.labels(), series.dates(),
                series.data(), series.target(), series.lastYear());
    }

    private List<String> resolveBillToCodesForChannelAndStatus(String channelFilter, String status) {
        String statusClause = OperationalStatusFilter.whereClause(status);
        if (channelFilter == null && statusClause.isEmpty()) {
            return null;
        }
        StringBuilder sql = new StringBuilder("SELECT DISTINCT Site_Code FROM Site_Master WHERE Sales_Type = 'Primary Sales' ");
        List<Object> params = new ArrayList<>();
        if (channelFilter != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(?) ");
            params.add(channelFilter);
        }
        sql.append(statusClause);
        return jdbcTemplate.queryForList(sql.toString(), String.class, params.toArray());
    }

    private void appendBillToFilter(StringBuilder sql, List<Object> params, List<String> billToCodes) {
        if (billToCodes == null) {
            return;
        }
        if (billToCodes.isEmpty()) {
            sql.append("AND 1 = 0 ");
            return;
        }
        sql.append("AND ps.Bill_to IN (")
                .append(billToCodes.stream().map(c -> "?").collect(java.util.stream.Collectors.joining(",")))
                .append(") ");
        params.addAll(billToCodes);
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

    private Map<LocalDate, BigDecimal> dayTotalsInRange(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT CAST(ps.Sales_Date AS DATE) AS d, SUM(ps.Sales) AS total FROM Primary_Sales ps ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code ");
        }
        sql.append("WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY CAST(ps.Sales_Date AS DATE)");

        Map<LocalDate, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(((Date) row.get("d")).toLocalDate(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> monthTotalsInRange(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(ps.Sales_Date) AS yr, MONTH(ps.Sales_Date) AS mo, SUM(ps.Sales) AS total FROM Primary_Sales ps ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code ");
        }
        sql.append("WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY YEAR(ps.Sales_Date), MONTH(ps.Sales_Date)");

        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            int yr = ((Number) row.get("yr")).intValue();
            int mo = ((Number) row.get("mo")).intValue();
            totals.put(YearMonth.of(yr, mo), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<Integer, BigDecimal> yearTotalsInRange(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(ps.Sales_Date) AS yr, SUM(ps.Sales) AS total FROM Primary_Sales ps ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code ");
        }
        sql.append("WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY YEAR(ps.Sales_Date)");

        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(((Number) row.get("yr")).intValue(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private TrendSeries buildDayRangeView(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        Map<LocalDate, BigDecimal> totals = dayTotalsInRange(from, to, brand, billToCodes);
        Map<LocalDate, BigDecimal> lastYearTotals = dayTotalsInRange(from.minusYears(1), to.minusYears(1), brand, billToCodes);

        Map<YearMonth, BigDecimal> monthlyTargets = primarySalesTargetService.getMonthlyTargetsInRange(
                YearMonth.from(from), YearMonth.from(to), brand);

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

    private TrendSeries buildMonthRangeView(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        Map<YearMonth, BigDecimal> totals = monthTotalsInRange(from, to, brand, billToCodes);
        Map<YearMonth, BigDecimal> lastYearTotals = monthTotalsInRange(from.minusYears(1), to.minusYears(1), brand, billToCodes);

        YearMonth end = YearMonth.from(to);
        YearMonth start = YearMonth.from(from);
        Map<YearMonth, BigDecimal> monthlyTargets = primarySalesTargetService.getMonthlyTargetsInRange(start, end, brand);

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

    private TrendSeries buildYearRangeView(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        Map<Integer, BigDecimal> totals = yearTotalsInRange(from, to, brand, billToCodes);
        Map<Integer, BigDecimal> lastYearTotals = yearTotalsInRange(from.minusYears(1), to.minusYears(1), brand, billToCodes);

        Map<Integer, BigDecimal> yearlyTargets = primarySalesTargetService.getYearlyTargetsInRange(from.getYear(), to.getYear(), brand);

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
