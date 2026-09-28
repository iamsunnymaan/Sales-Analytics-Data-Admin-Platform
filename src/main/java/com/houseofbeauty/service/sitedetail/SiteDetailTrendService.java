package com.houseofbeauty.service.sitedetail;

import com.houseofbeauty.dto.sitedetail.response.TrendPeriod;
import com.houseofbeauty.dto.sitedetail.response.TrendRangeResponse;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

@Service
public class SiteDetailTrendService {

    private static final Set<String> VALID_GRANULARITIES = Set.of("day", "month", "year");

    private static final int MAX_DAY_SPAN = 400;
    private static final int MAX_MONTH_SPAN = 600;
    private static final int MAX_YEAR_SPAN = 200;

    private static final DateTimeFormatter DAY_LABEL_FORMAT = DateTimeFormatter.ofPattern("d-MMM-uu", Locale.ENGLISH);

    private final JdbcTemplate jdbcTemplate;

    public SiteDetailTrendService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Integer> getYearsWithData(String siteCode, String brand) {
        TreeSet<Integer> years = new TreeSet<>();
        years.addAll(jdbcTemplate.queryForList(
                "SELECT DISTINCT YEAR(Sales_Date) FROM Primary_Sales WHERE Bill_to = ? AND Brand = ?",
                Integer.class, siteCode, brand));
        years.addAll(jdbcTemplate.queryForList(
                "SELECT DISTINCT YEAR(Sales_Date) FROM Secondary_Sales WHERE Site_Code = ? AND Brand = ?",
                Integer.class, siteCode, brand));
        years.add(Year.now().getValue());
        return new ArrayList<>(years);
    }

    public TrendRangeResponse getTrendRange(String siteCode, String brand, LocalDate from, LocalDate to,
                                             String granularity) {
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

        List<Map<String, Object>> profileRows = jdbcTemplate.queryForList(
                "SELECT Channel, Partner FROM site_master WHERE Site_Code = ? AND Brand = ?", siteCode, brand);
        String channel = profileRows.isEmpty() ? null : (String) profileRows.get(0).get("Channel");
        String partner = profileRows.isEmpty() ? null : (String) profileRows.get(0).get("Partner");

        TrendSeries series = switch (normalizedGranularity) {
            case "month" -> buildMonthRangeView(periodFrom, periodTo, siteCode, brand, channel, partner);
            case "year" -> buildYearRangeView(periodFrom, periodTo, siteCode, brand, channel, partner);
            default -> buildDayRangeView(periodFrom, periodTo, siteCode, brand, channel, partner);
        };

        return new TrendRangeResponse(normalizedGranularity, new TrendPeriod(periodFrom.toString(), periodTo.toString()),
                series.labels(), series.dates(), series.primary(), series.secondary(), series.total(), series.target(),
                series.lastYear());
    }

    private record TrendSeries(List<String> labels, List<String> dates, List<BigDecimal> primary,
                                List<BigDecimal> secondary, List<BigDecimal> total, List<BigDecimal> target,
                                List<BigDecimal> lastYear) {
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

    private Map<LocalDate, BigDecimal> dayTotals(String table, String siteColumn, String siteCode, String brand,
                                                  LocalDate from, LocalDate to) {
        String sql = "SELECT CAST(Sales_Date AS DATE) AS d, SUM(Sales) AS total FROM " + table + " " +
                "WHERE " + siteColumn + " = ? AND Brand = ? AND Sales_Date BETWEEN ? AND ? " +
                "GROUP BY CAST(Sales_Date AS DATE)";
        Map<LocalDate, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, siteCode, brand, from, to)) {
            totals.put(((Date) row.get("d")).toLocalDate(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> monthTotals(String table, String siteColumn, String siteCode, String brand,
                                                     LocalDate from, LocalDate to) {
        String sql = "SELECT YEAR(Sales_Date) AS yr, MONTH(Sales_Date) AS mo, SUM(Sales) AS total FROM " + table + " " +
                "WHERE " + siteColumn + " = ? AND Brand = ? AND Sales_Date BETWEEN ? AND ? " +
                "GROUP BY YEAR(Sales_Date), MONTH(Sales_Date)";
        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, siteCode, brand, from, to)) {
            totals.put(YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue()),
                    asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<Integer, BigDecimal> yearTotals(String table, String siteColumn, String siteCode, String brand,
                                                 LocalDate from, LocalDate to) {
        String sql = "SELECT YEAR(Sales_Date) AS yr, SUM(Sales) AS total FROM " + table + " " +
                "WHERE " + siteColumn + " = ? AND Brand = ? AND Sales_Date BETWEEN ? AND ? " +
                "GROUP BY YEAR(Sales_Date)";
        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, siteCode, brand, from, to)) {
            totals.put(((Number) row.get("yr")).intValue(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> primaryMonthlyTargets(String channel, String partner, String brand,
                                                               LocalDate from, LocalDate to) {
        if (channel == null || partner == null) {
            return Map.of();
        }
        String sql = "SELECT Month AS ym, SUM(Sales_Target) AS total FROM Primary_Sales_Target " +
                "WHERE Brand = ? AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(LTRIM(RTRIM(?))) " +
                "AND LOWER(LTRIM(RTRIM(Partner))) = LOWER(LTRIM(RTRIM(?))) AND Month BETWEEN ? AND ? GROUP BY Month";
        return monthlyTargetMap(jdbcTemplate.queryForList(sql, brand, channel, partner,
                YearMonth.from(from).atDay(1), YearMonth.from(to).atEndOfMonth()));
    }

    private Map<YearMonth, BigDecimal> secondaryMonthlyTargets(String siteCode, String brand, LocalDate from, LocalDate to) {
        String sql = "SELECT Month AS ym, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Site_Code = ? AND Brand = ? AND Month BETWEEN ? AND ? GROUP BY Month";
        return monthlyTargetMap(jdbcTemplate.queryForList(sql, siteCode, brand,
                YearMonth.from(from).atDay(1), YearMonth.from(to).atEndOfMonth()));
    }

    private Map<YearMonth, BigDecimal> monthlyTargetMap(List<Map<String, Object>> rows) {
        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : rows) {
            Date ym = (Date) row.get("ym");
            if (ym == null) continue;
            LocalDate d = ym.toLocalDate();
            totals.merge(YearMonth.of(d.getYear(), d.getMonthValue()), asDecimal(row.get("total")), BigDecimal::add);
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> combinedMonthlyTargets(String siteCode, String brand, String channel,
                                                                String partner, LocalDate from, LocalDate to) {
        Map<YearMonth, BigDecimal> primary = primaryMonthlyTargets(channel, partner, brand, from, to);
        Map<YearMonth, BigDecimal> secondary = secondaryMonthlyTargets(siteCode, brand, from, to);
        Map<YearMonth, BigDecimal> combined = new HashMap<>(primary);
        secondary.forEach((ym, val) -> combined.merge(ym, val, BigDecimal::add));
        return combined;
    }

    private TrendSeries buildDayRangeView(LocalDate from, LocalDate to, String siteCode, String brand,
                                           String channel, String partner) {
        Map<LocalDate, BigDecimal> primaryTotals = dayTotals("Primary_Sales", "Bill_to", siteCode, brand, from, to);
        Map<LocalDate, BigDecimal> secondaryTotals = dayTotals("Secondary_Sales", "Site_Code", siteCode, brand, from, to);
        Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargets(siteCode, brand, channel, partner, from, to);

        Map<LocalDate, BigDecimal> primaryLastYearTotals = dayTotals("Primary_Sales", "Bill_to", siteCode, brand, from.minusYears(1), to.minusYears(1));
        Map<LocalDate, BigDecimal> secondaryLastYearTotals = dayTotals("Secondary_Sales", "Site_Code", siteCode, brand, from.minusYears(1), to.minusYears(1));

        List<String> labels = new ArrayList<>();
        List<String> dates = new ArrayList<>();
        List<BigDecimal> primary = new ArrayList<>();
        List<BigDecimal> secondary = new ArrayList<>();
        List<BigDecimal> total = new ArrayList<>();
        List<BigDecimal> target = new ArrayList<>();
        List<BigDecimal> lastYear = new ArrayList<>();
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            labels.add(date.format(DAY_LABEL_FORMAT));
            dates.add(date.toString());
            BigDecimal p = primaryTotals.getOrDefault(date, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
            BigDecimal s = secondaryTotals.getOrDefault(date, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
            primary.add(p);
            secondary.add(s);
            total.add(p.add(s));
            YearMonth ym = YearMonth.from(date);
            BigDecimal monthlyTarget = monthlyTargets.getOrDefault(ym, BigDecimal.ZERO);
            target.add(monthlyTarget.divide(BigDecimal.valueOf(ym.lengthOfMonth()), 2, RoundingMode.HALF_UP));
            LocalDate lastYearDate = date.minusYears(1);
            BigDecimal lyp = primaryLastYearTotals.getOrDefault(lastYearDate, BigDecimal.ZERO);
            BigDecimal lys = secondaryLastYearTotals.getOrDefault(lastYearDate, BigDecimal.ZERO);
            lastYear.add(lyp.add(lys).setScale(2, RoundingMode.HALF_UP));
        }
        return new TrendSeries(labels, dates, primary, secondary, total, target, lastYear);
    }

    private TrendSeries buildMonthRangeView(LocalDate from, LocalDate to, String siteCode, String brand,
                                             String channel, String partner) {
        Map<YearMonth, BigDecimal> primaryTotals = monthTotals("Primary_Sales", "Bill_to", siteCode, brand, from, to);
        Map<YearMonth, BigDecimal> secondaryTotals = monthTotals("Secondary_Sales", "Site_Code", siteCode, brand, from, to);
        Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargets(siteCode, brand, channel, partner, from, to);
        Map<YearMonth, BigDecimal> primaryLastYearTotals = monthTotals("Primary_Sales", "Bill_to", siteCode, brand, from.minusYears(1), to.minusYears(1));
        Map<YearMonth, BigDecimal> secondaryLastYearTotals = monthTotals("Secondary_Sales", "Site_Code", siteCode, brand, from.minusYears(1), to.minusYears(1));

        YearMonth start = YearMonth.from(from);
        YearMonth end = YearMonth.from(to);

        List<String> labels = new ArrayList<>();
        List<String> dates = new ArrayList<>();
        List<BigDecimal> primary = new ArrayList<>();
        List<BigDecimal> secondary = new ArrayList<>();
        List<BigDecimal> total = new ArrayList<>();
        List<BigDecimal> target = new ArrayList<>();
        List<BigDecimal> lastYear = new ArrayList<>();
        for (YearMonth ym = start; !ym.isAfter(end); ym = ym.plusMonths(1)) {
            labels.add(ym.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + ym.getYear());
            dates.add(ym.toString());
            BigDecimal p = primaryTotals.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
            BigDecimal s = secondaryTotals.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
            primary.add(p);
            secondary.add(s);
            total.add(p.add(s));
            target.add(monthlyTargets.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            YearMonth lastYearYm = ym.minusYears(1);
            BigDecimal lyp = primaryLastYearTotals.getOrDefault(lastYearYm, BigDecimal.ZERO);
            BigDecimal lys = secondaryLastYearTotals.getOrDefault(lastYearYm, BigDecimal.ZERO);
            lastYear.add(lyp.add(lys).setScale(2, RoundingMode.HALF_UP));
        }
        return new TrendSeries(labels, dates, primary, secondary, total, target, lastYear);
    }

    private TrendSeries buildYearRangeView(LocalDate from, LocalDate to, String siteCode, String brand,
                                            String channel, String partner) {
        Map<Integer, BigDecimal> primaryTotals = yearTotals("Primary_Sales", "Bill_to", siteCode, brand, from, to);
        Map<Integer, BigDecimal> secondaryTotals = yearTotals("Secondary_Sales", "Site_Code", siteCode, brand, from, to);
        Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargets(siteCode, brand, channel, partner, from, to);
        Map<Integer, BigDecimal> primaryLastYearTotals = yearTotals("Primary_Sales", "Bill_to", siteCode, brand, from.minusYears(1), to.minusYears(1));
        Map<Integer, BigDecimal> secondaryLastYearTotals = yearTotals("Secondary_Sales", "Site_Code", siteCode, brand, from.minusYears(1), to.minusYears(1));

        List<String> labels = new ArrayList<>();
        List<String> dates = new ArrayList<>();
        List<BigDecimal> primary = new ArrayList<>();
        List<BigDecimal> secondary = new ArrayList<>();
        List<BigDecimal> total = new ArrayList<>();
        List<BigDecimal> target = new ArrayList<>();
        List<BigDecimal> lastYear = new ArrayList<>();
        for (int year = from.getYear(); year <= to.getYear(); year++) {
            labels.add(String.valueOf(year));
            dates.add(String.valueOf(year));
            BigDecimal p = primaryTotals.getOrDefault(year, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
            BigDecimal s = secondaryTotals.getOrDefault(year, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
            primary.add(p);
            secondary.add(s);
            total.add(p.add(s));
            BigDecimal yearTarget = BigDecimal.ZERO;
            for (int m = 1; m <= 12; m++) {
                yearTarget = yearTarget.add(monthlyTargets.getOrDefault(YearMonth.of(year, m), BigDecimal.ZERO));
            }
            target.add(yearTarget.setScale(2, RoundingMode.HALF_UP));
            int lastYearYear = year - 1;
            BigDecimal lyp = primaryLastYearTotals.getOrDefault(lastYearYear, BigDecimal.ZERO);
            BigDecimal lys = secondaryLastYearTotals.getOrDefault(lastYearYear, BigDecimal.ZERO);
            lastYear.add(lyp.add(lys).setScale(2, RoundingMode.HALF_UP));
        }
        return new TrendSeries(labels, dates, primary, secondary, total, target, lastYear);
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal bd) return bd;
        if (value == null) return BigDecimal.ZERO;
        return new BigDecimal(value.toString());
    }
}
