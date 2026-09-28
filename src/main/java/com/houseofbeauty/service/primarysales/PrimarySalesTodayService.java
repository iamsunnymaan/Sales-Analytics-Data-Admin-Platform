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

    public List<String> getAvailableBrands() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master " +
                "WHERE Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> ''";

        java.util.Set<String> brands = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            brands.add(((String) row.get("Brand")).trim());
        }
        return new ArrayList<>(brands);
    }

    public List<String> getAvailableChannels() {
        String sql = "SELECT DISTINCT Channel FROM Site_Master " +
                "WHERE Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> '' AND Sales_Type = 'Primary Sales'";
        java.util.Set<String> channels = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            channels.add(((String) row.get("Channel")).trim());
        }
        return new ArrayList<>(channels);
    }

    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM Site_Master WHERE Sales_Type = 'Primary Sales'", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    private static LocalDate resolveAsOf(LocalDate asOf) {
        LocalDate now = LocalDate.now();
        if (asOf == null) {
            return now;
        }
        return asOf.isAfter(now) ? now : asOf;
    }

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
