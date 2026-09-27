package com.houseofbeauty.service.primarysales;

import com.houseofbeauty.dto.primarysales.response.MonthlyBreakdownEntry;
import com.houseofbeauty.dto.primarysales.response.MonthlySalesResponse;
import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.ChannelFilter;
import com.houseofbeauty.service.topprojection.TopProjectionService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// Backs the Primary Sales page's Overview Insights card — every row this card shows is now real (see
// getMonthlySales' own comment; Projection Vs Target needs no dedicated field here at all, it's
// derived entirely on the frontend from periodTarget/topProjectionValue/periodSales, see
// PrimarySalesPage.js's loadInsightsCard). getMonthlyBreakdown (the separate month-by-month
// Outstanding breakdown data, still `asOf`-based — unrelated to the Insights card) is untouched.
@Service
public class PrimarySalesTodayService {

    private final JdbcTemplate jdbcTemplate;
    private final PrimarySalesTargetService primarySalesTargetService;
    private final TopProjectionService topProjectionService;
    private final PrimarySalesReportsService primarySalesReportsService;

    public PrimarySalesTodayService(JdbcTemplate jdbcTemplate, PrimarySalesTargetService primarySalesTargetService,
                                     TopProjectionService topProjectionService,
                                     PrimarySalesReportsService primarySalesReportsService) {
        this.jdbcTemplate = jdbcTemplate;
        this.primarySalesTargetService = primarySalesTargetService;
        this.topProjectionService = topProjectionService;
        this.primarySalesReportsService = primarySalesReportsService;
    }

    public static String normalizeBrand(String brand) {
        return BrandFilter.normalize(brand);
    }

    // Real distinct Brand values Site_Master currently has, trimmed/deduped/sorted — backs the
    // Primary Sales page's Brand pill (GET /api/primary-sales/brands) so it shows "All" plus
    // whatever Site_Master's own Brand vocabulary is, instead of this page hardcoding "ABH"/"Kylie"
    // in HTML. Same pattern as TopProjectionService.getAvailableChannels. The frontend maps each real
    // value ("Anastasia Beverly hills"/"Kylie Cosmetics" — Site_Master's real full-name vocabulary,
    // NOT the "ABH"/"Kylie" short codes this comment used to (wrongly) claim it stores, see
    // getMonthlySales' own header comment) to its own short "abh"/"kylie" data-brand attribute via
    // BrandFilter.js's brandNameToCode, which BrandFilter.normalize (server-side) accepts back.
    public List<String> getAvailableBrands() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master " +
                "WHERE Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> ''";
        // Case-insensitive dedup/sort, same as TopProjectionService.getAvailableChannels — real
        // Site_Master text isn't reliably consistent-cased (that class's own comment notes
        // "online"/"Online" both occurring in the wild for Channel; Brand isn't guaranteed better).
        java.util.Set<String> brands = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            brands.add(((String) row.get("Brand")).trim());
        }
        return new ArrayList<>(brands);
    }

    // Real distinct Channel values Site_Master currently has, scoped to Sales_Type = 'Primary Sales'
    // — backs the Filter Header's Channel pill (GET /api/primary-sales/channels), same pattern
    // getAvailableBrands above already uses and same real query TopProjectionService.
    // getAvailableChannels runs, just without that class's own display-casing normalization (kept
    // as the raw trimmed value here, same convention getAvailableBrands follows for Brand — the
    // frontend shows it as-is and echoes it back verbatim as the filter's own channel param).
    public List<String> getAvailableChannels() {
        String sql = "SELECT DISTINCT Channel FROM Site_Master " +
                "WHERE Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> '' AND Sales_Type = 'Primary Sales'";
        java.util.Set<String> channels = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            channels.add(((String) row.get("Channel")).trim());
        }
        return new ArrayList<>(channels);
    }

    // Status pill options — backs the Filter Header's Status pill (GET /api/primary-sales/statuses),
    // fetched the same way as Brand/Channel above per explicit request, instead of the pill's
    // All/Active/Inactive/Upcoming buttons being hardcoded straight into PrimarySalesPage.html the way
    // they used to be. The category list itself (Active/Inactive/Upcoming) is the same fixed, app-wide
    // Site Status vocabulary OperationalStatusFilter classifies against — NOT derived from Site_
    // Master's own live distinct Operational_Status text (that column is free text with no canonical
    // enumeration to query, see OperationalStatusFilter's own header comment), so "Upcoming" is always
    // offered here even before any real Primary Sales site is actually tagged with it yet — a "new
    // entry lands with a status this filter hasn't seen before" case this endpoint already needs to
    // support without a future code change. The COUNT(*) below is a real Site_Master round-trip
    // (not a hardcoded return) so an actual DB-connectivity problem (query throws) OR an empty/not-yet-
    // imported Site_Master for this Sales_Type (count 0) both surface as an empty list here — same
    // "Not Available" fallback Brand/Channel's own fetch failure already shows, per explicit request
    // ("if database is not connected then show not available same as we do in the brand and channel
    // filter" — see PrimarySalesPage.js's loadStatusPillOptions/renderStatusPill).
    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM Site_Master WHERE Sales_Type = 'Primary Sales'", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    // Never lets a caller-supplied reference date land in the future — there's no data to show yet.
    private static LocalDate resolveAsOf(LocalDate asOf) {
        LocalDate now = LocalDate.now();
        if (asOf == null) {
            return now;
        }
        return asOf.isAfter(now) ? now : asOf;
    }

    // Month Target, MTD Sales, and Projection are all real, per their own explicit specs (Projection
    // Vs Target needs nothing further from this method — it's derived entirely on the frontend from
    // periodTarget/topProjectionValue/periodSales, since Target is already exactly "periodTarget" for
    // every one of its cases). Month Target/MTD Sales resolve their end date DIFFERENTLY on purpose:
    //  - Month Target (periodTarget/previousPeriodTarget/lastYearPeriodTarget) always uses complete
    //    calendar YearMonth(s) (see PrimarySalesReportsService#getComboMatchedTargetSum, which sums by
    //    Month/year regardless of the day-of-month on the LocalDate it's given) — NEVER reduced to
    //    today's date, even for the current month. Same logic "5. Reports" own Mnt figure uses (see
    //    that method's own comment): only a real (Brand, Channel, Partner) combo Site_Master AND
    //    Primary_Sales_Target both recognize contributes, so this can be lower than a flat whole-table-
    //    for-the-brand sum whenever Primary_Sales_Target has a combo Site_Master doesn't (or vice
    //    versa).
    //  - MTD Sales (periodSales/previousPeriodSales/lastYearElapsedSales) DOES track today: salesTo
    //    is clamped to whichever is earlier of the selection's end date or today, so a historical
    //    month sums in full but the current month (or a multi-month range reaching into it) stops at
    //    today. Same logic "5. Reports" own MTD Sales figure uses (see PrimarySalesReportsService#
    //    getSiteJoinedSalesSum) — Ship_to = Site_Master.Site_Code is the only relation tying a sale
    //    back to a Brand, so a sale whose Ship_to Site_Master doesn't currently recognize contributes
    //    nothing here, same as it doesn't in the Reports section.
    // previousPeriodTarget/previousPeriodSales are always just the single immediately-preceding
    // calendar month/elapsed-day window, regardless of how many months [from, to] spans — the
    // frontend (loadInsightsCard) is what decides to hide Vs LM for a multi-month selection rather
    // than comparing against some multi-month block before it.
    //
    // FIXED: Site_Master.Brand/Primary_Sales_Target.Brand/Primary_Sales_Projection.Brand all store the
    // same full-name vocabulary ("Anastasia Beverly hills"/"Kylie Cosmetics" — confirmed live against
    // the DB), NOT BrandFilter.target()'s short-code vocabulary ("ABH"/"Kylie") those columns used
    // before the 2026-09-02 Primary/Secondary Sales rebuild. This used to pass BrandFilter.target()
    // into getComboMatchedTargetSum/getSiteJoinedSalesSum (both Site_Master-joined, via loadSiteRows)
    // and topProjectionService.getProjectionTotalForMonth, which all silently matched zero rows for any
    // specific brand — Month Target/MTD Sales/Projection all stayed stuck at ₹0 the instant a real
    // brand was selected on the Overview Insights card, while "All" (brand filter null) worked by
    // accident — same bug already independently found and fixed in PrimarySalesDailyTrendService/
    // SecondarySalesDailyTrendService (see that class's own comment) but missed here.
    public MonthlySalesResponse getMonthlySales(String brand, LocalDate from, LocalDate to, String channel, String status) {
        String normalizedBrand = normalizeBrand(brand);
        String brandFilter = BrandFilter.product(normalizedBrand);
        String channelFilter = ChannelFilter.normalize(channel);

        LocalDate today = LocalDate.now();
        LocalDate rawFrom = from == null ? today.withDayOfMonth(1) : from;
        LocalDate rawTo = to == null ? today : to;
        LocalDate periodFrom = (rawTo.isBefore(rawFrom) ? rawTo : rawFrom).withDayOfMonth(1);
        LocalDate periodToRaw = rawTo.isBefore(rawFrom) ? rawFrom : rawTo;

        YearMonth fromMonth = YearMonth.from(periodFrom);
        YearMonth toMonth = YearMonth.from(periodToRaw);
        BigDecimal periodTarget = primarySalesReportsService.getComboMatchedTargetSum(fromMonth, toMonth, brandFilter, channelFilter, status);

        YearMonth previousMonth = fromMonth.minusMonths(1);
        BigDecimal previousPeriodTarget =
                primarySalesReportsService.getComboMatchedTargetSum(previousMonth, previousMonth, brandFilter, channelFilter, status);

        YearMonth lastYearFromMonth = fromMonth.minusYears(1);
        YearMonth lastYearToMonth = toMonth.minusYears(1);
        BigDecimal lastYearPeriodTarget =
                primarySalesReportsService.getComboMatchedTargetSum(lastYearFromMonth, lastYearToMonth, brandFilter, channelFilter, status);

        LocalDate salesTo = periodToRaw.isAfter(today) ? today : periodToRaw;
        BigDecimal periodSales = primarySalesReportsService.getSiteJoinedSalesSum(periodFrom, salesTo, brandFilter, channelFilter, status);

        LocalDate lastMonthFrom = periodFrom.minusMonths(1);
        LocalDate lastMonthTo = salesTo.minusMonths(1);
        BigDecimal previousPeriodSales = primarySalesReportsService.getSiteJoinedSalesSum(lastMonthFrom, lastMonthTo, brandFilter, channelFilter, status);

        LocalDate lastYearFrom = periodFrom.minusYears(1);
        LocalDate lastYearTo = salesTo.minusYears(1);
        BigDecimal lastYearElapsedSales = primarySalesReportsService.getSiteJoinedSalesSum(lastYearFrom, lastYearTo, brandFilter, channelFilter, status);

        // Projection — always the real current calendar month's own Primary_Sales_Projection total, plus
        // the immediately preceding month's and the same month last year's, completely independent
        // of whatever [from, to] was requested: the frontend only ever uses these when the selection
        // resolves to exactly this real current month in the first place (see loadInsightsCard), so
        // there's no [from, to]-driven variant to compute here, unlike Month Target/MTD Sales above.
        YearMonth currentMonth = YearMonth.now();
        BigDecimal topProjectionValue = topProjectionService.getProjectionTotalForMonth(currentMonth, brandFilter);
        BigDecimal previousMonthProjectionValue =
                topProjectionService.getProjectionTotalForMonth(currentMonth.minusMonths(1), brandFilter);
        BigDecimal lastYearMonthProjectionValue =
                topProjectionService.getProjectionTotalForMonth(currentMonth.minusYears(1), brandFilter);

        return new MonthlySalesResponse(periodSales, BigDecimal.ZERO, BigDecimal.ZERO,
                previousPeriodSales, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                lastYearElapsedSales, BigDecimal.ZERO, BigDecimal.ZERO,
                periodTarget, previousPeriodTarget, lastYearPeriodTarget,
                topProjectionValue, BigDecimal.ZERO, BigDecimal.ZERO,
                previousMonthProjectionValue, lastYearMonthProjectionValue);
    }

    // Sales + transaction count (COUNT DISTINCT BillNo, since one transaction/bill can span several
    // ArticleCode line items) + unit quantity, all in one query, for a date range.
    private Map<String, BigDecimal> salesTransactionsQty(LocalDate from, LocalDate to, String brandFilter) {
        StringBuilder sql = new StringBuilder(
                "SELECT SUM(ps.Sales) AS sales, COUNT(DISTINCT ps.Bill_No) AS transactions, SUM(ps.Qty) AS qty FROM Primary_Sales ps ");
        List<Object> params = new ArrayList<>(List.of(from, to));
        if (brandFilter != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code ");
        }
        sql.append("WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brandFilter != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brandFilter);
        }
        Map<String, Object> row = jdbcTemplate.queryForMap(sql.toString(), params.toArray());

        Map<String, BigDecimal> result = new LinkedHashMap<>();
        result.put("sales", asDecimal(row.get("sales")));
        result.put("transactions", asDecimal(row.get("transactions")));
        result.put("qty", asDecimal(row.get("qty")));
        return result;
    }

    private BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        if (value instanceof Number number) {
            return BigDecimal.valueOf(number.doubleValue());
        }
        return BigDecimal.ZERO;
    }

    // One row per calendar month from January through the current month of the current year
    // (year-to-date), real actual sales only, brand-filterable. Backs the Monthly Sales card's
    // month-basis Outstanding: the frontend nets each month's surplus/deficit against the real
    // Monthly Target for that month across all these months, so a month that beat its target can
    // offset a prior month that missed it.
    // FIXED: previously used BrandFilter.target() (short-code "ABH"/"Kylie") for the
    // primarySalesTargetService.getMonthlyTargetsForYear call below, which filters Primary_Sales_
    // Target.Brand directly — that column stores the same full-name vocabulary as Product_Master.Brand
    // (see getMonthlySales' own header comment for the fuller story), so a specific brand silently
    // zeroed out this popup's own Target column. One brandFilter value now covers both the
    // Product_Master-joined Sales query below and the Target lookup.
    public List<MonthlyBreakdownEntry> getMonthlyBreakdown(String brand, LocalDate asOf) {
        String normalizedBrand = normalizeBrand(brand);
        String brandFilter = BrandFilter.product(normalizedBrand);
        LocalDate today = resolveAsOf(asOf);
        int year = today.getYear();
        int currentMonth = today.getMonthValue();

        StringBuilder sql = new StringBuilder("SELECT MONTH(ps.Sales_Date) AS m, SUM(ps.Sales) AS total FROM Primary_Sales ps ");
        List<Object> params = new ArrayList<>(List.of(year, currentMonth, today));
        if (brandFilter != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code ");
        }
        sql.append("WHERE YEAR(ps.Sales_Date) = ? AND MONTH(ps.Sales_Date) <= ? AND ps.Sales_Date <= ? ");
        if (brandFilter != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brandFilter);
        }
        sql.append("GROUP BY MONTH(ps.Sales_Date)");

        Map<Integer, BigDecimal> totals = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            totals.put(((Number) row.get("m")).intValue(), total.setScale(2, RoundingMode.HALF_UP));
        }
        Map<Integer, BigDecimal> targets = primarySalesTargetService.getMonthlyTargetsForYear(year, currentMonth, brandFilter);

        List<MonthlyBreakdownEntry> months = new ArrayList<>();
        for (int month = 1; month <= currentMonth; month++) {
            months.add(new MonthlyBreakdownEntry(year, month, totals.getOrDefault(month, BigDecimal.ZERO),
                    targets.getOrDefault(month, BigDecimal.ZERO)));
        }
        return months;
    }
}
