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

// Backs the Primary Sales page's "Daily Trend Graph" section: a real amount series (with a real
// Monthly Target pace line and the same period last year), bucketed by day, month, or year
// depending on the active date-filter mode.
@Service
public class PrimarySalesDailyTrendService {

    private static final Set<String> VALID_GRANULARITIES = Set.of("day", "month", "year");
    // Caps how many buckets getTrendRange's loops can generate for a given granularity — guards
    // against a pathological [from, to] (e.g. a malformed request, or a partially-typed date input
    // firing a request mid-edit) making the day/month/year loops build an enormous label/data list.
    private static final int MAX_DAY_SPAN = 400;
    private static final int MAX_MONTH_SPAN = 600;
    private static final int MAX_YEAR_SPAN = 200;
    // "5-Jan-26" — day granularity's x-axis label is now a full date (not just day-of-month), since
    // By Date can span multiple months/years and a bare day number would be ambiguous. 2-digit year
    // per explicit request (matches SecondarySalesDailyTrendService's own DAY_LABEL_FORMAT).
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

    // Single real amount series for an arbitrary [from, to] window, bucketed by whichever
    // granularity the frontend's active SalesDateFilter mode implies:
    // "day" for a single selected month (x-axis = day-of-month 1..N), "month" for an arbitrary date
    // range (x-axis = the months the range touches), "year" for a year range (x-axis = the years).
    // [from, to] defaults to the current calendar month, matching PrimarySalesProductLevelService.
    public TrendRangeResponse getTrendRange(LocalDate from, LocalDate to, String granularity, String brand, String channel, String status) {
        String normalizedBrand = BrandFilter.normalize(brand);
        // FIXED 2026-09-07: Primary_Sales_Target.Brand stores the SAME full-name vocabulary as
        // Product_Master.Brand ("Anastasia Beverly hills"/"Kylie Cosmetics" — confirmed live against
        // the DB), NOT BrandFilter.target()'s short-code vocabulary ("ABH"/"Kylie") that column used
        // to use before the 2026-09-02 Primary/Secondary Sales rebuild. This used to pass
        // BrandFilter.target() into primarySalesTargetService, which silently matched zero
        // Primary_Sales_Target rows for any specific brand — Target (and Sales vs Target) stayed
        // stuck at 0 the instant a real brand was selected, while "All" (both null) worked by
        // accident — same bug independently found and fixed in SecondarySalesDailyTrendService.
        // Both Sales (Product_Master-joined) and Target now share one brandFilter value.
        String brandFilter = BrandFilter.product(normalizedBrand);
        // Channel/Status filtering — Primary_Sales has no Channel/Status column of its own and no
        // Site_Master join in this class's own queries (unlike PrimarySalesReportsService, which
        // already loads Site_Master rows for Overview/Reports); resolveBillToCodesForChannelAndStatus
        // below pre-fetches just the Site_Codes this channel/status combo covers, then every query
        // adds "AND ps.Bill_to IN (...)" rather than joining Site_Master directly (a direct join risks
        // fanning a Primary_Sales row out across more than one Site_Master row for the same Site_Code,
        // since Site_Master's real key is (Site_Code, Brand) — an IN-list filter can't double-count a
        // row, a JOIN could). Target (getMonthlyTargetsInRange/getYearlyTargetsInRange below) stays
        // brand-only — Primary_Sales_Target has no Site_Code/Channel/Status dimension this service can
        // filter by without a much bigger change (see PrimarySalesReportsService's own targetsByCombo
        // for the one place that combo-matching is already done), so the pace line intentionally does
        // not react to Channel or Status.
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

    // null = every channel AND every status (no filter of either). Otherwise the real, distinct
    // Site_Codes Site_Master says match whichever of Channel/Status is active among Primary Sales
    // sites — an empty (non-null) list means that combo exists nowhere in Site_Master right now, so
    // every query below correctly contributes zero instead of accidentally matching everything (see
    // appendBillToFilter's own empty-list handling).
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

    // Appends "AND ps.Bill_to IN (...)" when billToCodes is non-null — an empty list still appends a
    // clause that always evaluates false (1 = 0) rather than an invalid empty IN(), so "channel
    // exists in Site_Master but has zero Primary Sales sites" correctly yields zero rows instead of
    // silently falling through to "no filter at all".
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

    // Internal shape shared by the three bucketing strategies below — getTrendRange wraps this with
    // granularity/brand/period into the public TrendRangeResponse.
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

    // X-axis is every calendar day in [from, to], labelled by day-of-month. `dates` carries the
    // full ISO date per bucket (yyyy-MM-dd) for the frontend tooltip. `labels` (the axis tick text)
    // is a full "5-Jan-2026" date, not just the day-of-month, since By Date can span an arbitrary
    // range crossing months/years where a bare day number would be ambiguous. `lastYear` is each
    // day's own total exactly one calendar year earlier (LocalDate#minusYears handles Feb 29 by
    // folding to Feb 28).
    private TrendSeries buildDayRangeView(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        Map<LocalDate, BigDecimal> totals = dayTotalsInRange(from, to, brand, billToCodes);
        Map<LocalDate, BigDecimal> lastYearTotals = dayTotalsInRange(from.minusYears(1), to.minusYears(1), brand, billToCodes);

        // Target line: each day's target is its own month's real Monthly Target ÷ days in that
        // month (a flat "expected pace" line), so days in different months get different levels.
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

    // X-axis is every calendar month the range touches, one bucket per month regardless of how
    // wide the range is (even a single selected month stays one bucket — never expands into its
    // days, that's what By Date is for). Labels always include the year ("Jan 2026") for clarity —
    // `dates` (yyyy-MM) carries the same unambiguous period for the frontend tooltip. `lastYear` is
    // each month's own total exactly one calendar year earlier.
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

    // X-axis is every calendar year the range touches. `lastYear` is that year's own predecessor's
    // total (year-1) — already visible as its own bucket if in range, kept for tooltip consistency
    // with the day/month views.
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
