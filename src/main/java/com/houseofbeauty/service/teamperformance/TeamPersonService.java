package com.houseofbeauty.service.teamperformance;

import com.houseofbeauty.dto.teamperformance.response.PersonFyOverviewResponse;
import com.houseofbeauty.dto.teamperformance.response.PersonSiteRow;
import com.houseofbeauty.dto.teamperformance.response.PersonSitesResponse;
import com.houseofbeauty.dto.teamperformance.response.TrendPeriod;
import com.houseofbeauty.dto.teamperformance.response.TrendRangeResponse;
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
public class TeamPersonService {

    private static final Set<String> VALID_GRANULARITIES = Set.of("day", "month", "year");
    private static final int MAX_DAY_SPAN = 400;
    private static final int MAX_MONTH_SPAN = 600;
    private static final int MAX_YEAR_SPAN = 200;
    private static final DateTimeFormatter DAY_LABEL_FORMAT = DateTimeFormatter.ofPattern("d-MMM-uu", Locale.ENGLISH);

    private final JdbcTemplate jdbcTemplate;
    private final TeamSiteRepository teamSiteRepository;

    public TeamPersonService(JdbcTemplate jdbcTemplate, TeamSiteRepository teamSiteRepository) {
        this.jdbcTemplate = jdbcTemplate;
        this.teamSiteRepository = teamSiteRepository;
    }

    private static void appendPersonFilter(StringBuilder sql, List<Object> params, String levelColumn, String name) {
        if ("Uncategorized".equals(name)) {
            sql.append(" AND (sm.").append(levelColumn).append(" IS NULL OR sm.").append(levelColumn).append(" = '')");
        } else {
            sql.append(" AND sm.").append(levelColumn).append(" = ?");
            params.add(name);
        }
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal bd) return bd;
        if (value == null) return BigDecimal.ZERO;
        return new BigDecimal(value.toString());
    }

    public PersonSitesResponse getPersonSites(String level, String name, String status) {
        String levelColumn = TeamSiteRepository.requireLevelColumn(level);
        List<TeamSiteRow> rows = teamSiteRepository.loadSiteRows(null, status, levelColumn, name);
        List<PersonSiteRow> sites = rows.stream()
                .map(r -> new PersonSiteRow(r.siteCode(), r.brand(), r.storeName(), r.salesType()))
                .collect(Collectors.toList());
        return new PersonSitesResponse(name, level.toLowerCase(Locale.ROOT), sites.size(), sites);
    }

    private static int fyStartYear(String fyKey) {
        try {
            return Integer.parseInt(fyKey.split("-")[0]);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid fyKey: expected e.g. 2026-27");
        }
    }

    private Map<YearMonth, BigDecimal> monthlyActual(String table, String joinColumn, String salesTypeLiteral,
                                                       String levelColumn, String name, String status,
                                                       LocalDate from, LocalDate to) {
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(t.Sales_Date) AS yr, MONTH(t.Sales_Date) AS mo, SUM(t.Sales) AS total FROM " + table + " t " +
                        "JOIN site_master sm ON sm.Site_Code = t." + joinColumn + " AND sm.Brand = t.Brand " +
                        "WHERE sm.Sales_Type = ?" + OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        params.add(salesTypeLiteral);
        appendPersonFilter(sql, params, levelColumn, name);
        sql.append(" AND t.Sales_Date BETWEEN ? AND ? GROUP BY YEAR(t.Sales_Date), MONTH(t.Sales_Date)");
        params.add(from);
        params.add(to);
        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue()),
                    asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> secondaryMonthlyTarget(String levelColumn, String name, String status,
                                                                YearMonth fromMonth, YearMonth toMonth) {
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(sst.Month) AS yr, MONTH(sst.Month) AS mo, SUM(sst.Sales_Target) AS total " +
                        "FROM Secondary_Sales_Target sst " +
                        "JOIN site_master sm ON sm.Site_Code = sst.Site_Code AND sm.Brand = sst.Brand " +
                        "WHERE sm.Sales_Type = 'Secondary Sales'" + OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        appendPersonFilter(sql, params, levelColumn, name);
        sql.append(" AND sst.Month BETWEEN ? AND ? GROUP BY YEAR(sst.Month), MONTH(sst.Month)");
        params.add(fromMonth.atDay(1));
        params.add(toMonth.atDay(1));
        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue()),
                    asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> primaryMonthlyTarget(String levelColumn, String name, String status,
                                                              YearMonth fromMonth, YearMonth toMonth) {
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(pst.Month) AS yr, MONTH(pst.Month) AS mo, SUM(pst.Sales_Target) AS total " +
                        "FROM Primary_Sales_Target pst WHERE pst.Month BETWEEN ? AND ? AND EXISTS (" +
                        "SELECT 1 FROM site_master sm WHERE sm.Sales_Type = 'Primary Sales'" +
                        OperationalStatusFilter.whereClause(status, "sm.Operational_Status") +
                        " AND LOWER(LTRIM(RTRIM(sm.Brand))) = LOWER(LTRIM(RTRIM(pst.Brand)))" +
                        " AND LOWER(LTRIM(RTRIM(sm.Channel))) = LOWER(LTRIM(RTRIM(pst.Channel)))" +
                        " AND LOWER(LTRIM(RTRIM(sm.Partner))) = LOWER(LTRIM(RTRIM(pst.Partner)))");
        params.add(fromMonth.atDay(1));
        params.add(toMonth.atDay(1));
        appendPersonFilter(sql, params, levelColumn, name);
        sql.append(") GROUP BY YEAR(pst.Month), MONTH(pst.Month)");
        Map<YearMonth, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(YearMonth.of(((Number) row.get("yr")).intValue(), ((Number) row.get("mo")).intValue()),
                    asDecimal(row.get("total")));
        }
        return totals;
    }

    public PersonFyOverviewResponse getPersonFyOverview(String level, String name, String fyKey, String status) {
        String levelColumn = TeamSiteRepository.requireLevelColumn(level);
        int startYear = fyStartYear(fyKey);
        YearMonth fromMonth = YearMonth.of(startYear, 4);
        YearMonth toMonth = YearMonth.of(startYear + 1, 3);
        LocalDate from = fromMonth.atDay(1);
        LocalDate to = toMonth.atEndOfMonth();
        LocalDate lastYearFrom = from.minusYears(1);
        LocalDate lastYearTo = to.minusYears(1);

        Map<YearMonth, BigDecimal> primaryActual = monthlyActual("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, from, to);
        Map<YearMonth, BigDecimal> primaryLastYearActual = monthlyActual("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, lastYearFrom, lastYearTo);
        Map<YearMonth, BigDecimal> primaryTarget = primaryMonthlyTarget(levelColumn, name, status, fromMonth, toMonth);
        Map<YearMonth, BigDecimal> secondaryActual = monthlyActual("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, from, to);
        Map<YearMonth, BigDecimal> secondaryLastYearActual = monthlyActual("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, lastYearFrom, lastYearTo);
        Map<YearMonth, BigDecimal> secondaryTarget = secondaryMonthlyTarget(levelColumn, name, status, fromMonth, toMonth);

        List<String> months = new ArrayList<>();
        List<BigDecimal> pTarget = new ArrayList<>();
        List<BigDecimal> pSales = new ArrayList<>();
        List<BigDecimal> pLastYear = new ArrayList<>();
        List<BigDecimal> sTarget = new ArrayList<>();
        List<BigDecimal> sSales = new ArrayList<>();
        List<BigDecimal> sLastYear = new ArrayList<>();
        for (YearMonth ym = fromMonth; !ym.isAfter(toMonth); ym = ym.plusMonths(1)) {
            months.add(ym.toString());
            pTarget.add(primaryTarget.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            pSales.add(primaryActual.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            pLastYear.add(primaryLastYearActual.getOrDefault(ym.minusYears(1), BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            sTarget.add(secondaryTarget.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            sSales.add(secondaryActual.getOrDefault(ym, BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            sLastYear.add(secondaryLastYearActual.getOrDefault(ym.minusYears(1), BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
        }
        return new PersonFyOverviewResponse(name, level.toLowerCase(Locale.ROOT), fyKey, months,
                pTarget, pSales, pLastYear, sTarget, sSales, sLastYear);
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

    private Map<LocalDate, BigDecimal> dayTotals(String table, String joinColumn, String salesTypeLiteral,
                                                  String levelColumn, String name, String status,
                                                  LocalDate from, LocalDate to) {
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder(
                "SELECT CAST(t.Sales_Date AS DATE) AS d, SUM(t.Sales) AS total FROM " + table + " t " +
                        "JOIN site_master sm ON sm.Site_Code = t." + joinColumn + " AND sm.Brand = t.Brand " +
                        "WHERE sm.Sales_Type = ?" + OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        params.add(salesTypeLiteral);
        appendPersonFilter(sql, params, levelColumn, name);
        sql.append(" AND t.Sales_Date BETWEEN ? AND ? GROUP BY CAST(t.Sales_Date AS DATE)");
        params.add(from);
        params.add(to);
        Map<LocalDate, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(((Date) row.get("d")).toLocalDate(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<Integer, BigDecimal> yearTotals(String table, String joinColumn, String salesTypeLiteral,
                                                 String levelColumn, String name, String status,
                                                 LocalDate from, LocalDate to) {
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder(
                "SELECT YEAR(t.Sales_Date) AS yr, SUM(t.Sales) AS total FROM " + table + " t " +
                        "JOIN site_master sm ON sm.Site_Code = t." + joinColumn + " AND sm.Brand = t.Brand " +
                        "WHERE sm.Sales_Type = ?" + OperationalStatusFilter.whereClause(status, "sm.Operational_Status"));
        params.add(salesTypeLiteral);
        appendPersonFilter(sql, params, levelColumn, name);
        sql.append(" AND t.Sales_Date BETWEEN ? AND ? GROUP BY YEAR(t.Sales_Date)");
        params.add(from);
        params.add(to);
        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put(((Number) row.get("yr")).intValue(), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<YearMonth, BigDecimal> combinedMonthlyTargets(String levelColumn, String name, String status,
                                                                LocalDate from, LocalDate to) {
        YearMonth fromMonth = YearMonth.from(from);
        YearMonth toMonth = YearMonth.from(to);
        Map<YearMonth, BigDecimal> combined = new HashMap<>(primaryMonthlyTarget(levelColumn, name, status, fromMonth, toMonth));
        secondaryMonthlyTarget(levelColumn, name, status, fromMonth, toMonth).forEach((ym, val) -> combined.merge(ym, val, BigDecimal::add));
        return combined;
    }

    public TrendRangeResponse getPersonTrendRange(String level, String name, LocalDate from, LocalDate to,
                                                   String granularity, String status) {
        String levelColumn = TeamSiteRepository.requireLevelColumn(level);
        String normalizedGranularity = granularity == null ? "month" : granularity.toLowerCase(Locale.ROOT);
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

        List<String> labels = new ArrayList<>();
        List<String> dates = new ArrayList<>();
        List<BigDecimal> primary = new ArrayList<>();
        List<BigDecimal> secondary = new ArrayList<>();
        List<BigDecimal> total = new ArrayList<>();
        List<BigDecimal> target = new ArrayList<>();
        List<BigDecimal> lastYear = new ArrayList<>();

        if ("month".equals(normalizedGranularity)) {
            Map<YearMonth, BigDecimal> primaryTotals = monthlyActual("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, periodFrom, periodTo);
            Map<YearMonth, BigDecimal> secondaryTotals = monthlyActual("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, periodFrom, periodTo);
            Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargets(levelColumn, name, status, periodFrom, periodTo);
            Map<YearMonth, BigDecimal> primaryLastYear = monthlyActual("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, periodFrom.minusYears(1), periodTo.minusYears(1));
            Map<YearMonth, BigDecimal> secondaryLastYear = monthlyActual("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, periodFrom.minusYears(1), periodTo.minusYears(1));

            YearMonth start = YearMonth.from(periodFrom);
            YearMonth end = YearMonth.from(periodTo);
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
                BigDecimal lyp = primaryLastYear.getOrDefault(lastYearYm, BigDecimal.ZERO);
                BigDecimal lys = secondaryLastYear.getOrDefault(lastYearYm, BigDecimal.ZERO);
                lastYear.add(lyp.add(lys).setScale(2, RoundingMode.HALF_UP));
            }
        } else if ("year".equals(normalizedGranularity)) {
            Map<Integer, BigDecimal> primaryTotals = yearTotals("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, periodFrom, periodTo);
            Map<Integer, BigDecimal> secondaryTotals = yearTotals("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, periodFrom, periodTo);
            Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargets(levelColumn, name, status, periodFrom, periodTo);
            Map<Integer, BigDecimal> primaryLastYear = yearTotals("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, periodFrom.minusYears(1), periodTo.minusYears(1));
            Map<Integer, BigDecimal> secondaryLastYear = yearTotals("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, periodFrom.minusYears(1), periodTo.minusYears(1));

            for (int year = periodFrom.getYear(); year <= periodTo.getYear(); year++) {
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
                BigDecimal lyp = primaryLastYear.getOrDefault(lastYearYear, BigDecimal.ZERO);
                BigDecimal lys = secondaryLastYear.getOrDefault(lastYearYear, BigDecimal.ZERO);
                lastYear.add(lyp.add(lys).setScale(2, RoundingMode.HALF_UP));
            }
        } else {
            Map<LocalDate, BigDecimal> primaryTotals = dayTotals("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, periodFrom, periodTo);
            Map<LocalDate, BigDecimal> secondaryTotals = dayTotals("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, periodFrom, periodTo);
            Map<YearMonth, BigDecimal> monthlyTargets = combinedMonthlyTargets(levelColumn, name, status, periodFrom, periodTo);
            Map<LocalDate, BigDecimal> primaryLastYear = dayTotals("Primary_Sales", "Bill_to", "Primary Sales", levelColumn, name, status, periodFrom.minusYears(1), periodTo.minusYears(1));
            Map<LocalDate, BigDecimal> secondaryLastYear = dayTotals("Secondary_Sales", "Site_Code", "Secondary Sales", levelColumn, name, status, periodFrom.minusYears(1), periodTo.minusYears(1));

            for (LocalDate date = periodFrom; !date.isAfter(periodTo); date = date.plusDays(1)) {
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
                BigDecimal lyp = primaryLastYear.getOrDefault(lastYearDate, BigDecimal.ZERO);
                BigDecimal lys = secondaryLastYear.getOrDefault(lastYearDate, BigDecimal.ZERO);
                lastYear.add(lyp.add(lys).setScale(2, RoundingMode.HALF_UP));
            }
        }

        return new TrendRangeResponse(normalizedGranularity, new TrendPeriod(periodFrom.toString(), periodTo.toString()),
                labels, dates, primary, secondary, total, target, lastYear);
    }
}
