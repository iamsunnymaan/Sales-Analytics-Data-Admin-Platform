package com.houseofbeauty.service.secondarysales;

import com.houseofbeauty.dto.secondarysales.response.OverviewCell;
import com.houseofbeauty.dto.secondarysales.response.OverviewResponse;
import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.ChannelFilter;
import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
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
public class SecondarySalesOverviewService {

    private final JdbcTemplate jdbcTemplate;

    public SecondarySalesOverviewService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private record SiteRow(String siteCode, String brand, String channel, String operationalStatus) {
    }

    private static String siteKey(String siteCode, String brand) {
        return siteCode + "|" + brand;
    }

    private List<SiteRow> loadSiteRows() {
        List<SiteRow> rows = new ArrayList<>();
        String sql = "SELECT Site_Code, Brand, Channel, Operational_Status FROM Site_Master WHERE Sales_Type = 'Secondary Sales'";
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            String brand = (String) row.get("Brand");
            String channel = (String) row.get("Channel");
            rows.add(new SiteRow((String) row.get("Site_Code"),
                    brand == null ? null : brand.trim(),
                    channel == null || channel.isBlank() ? null : normalizeChannelDisplay(channel),
                    (String) row.get("Operational_Status")));
        }
        return rows;
    }

    public List<String> getAvailableBrands() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master " +
                "WHERE Sales_Type = 'Secondary Sales' AND Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> ''";
        TreeSet<String> brands = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String brand : jdbcTemplate.queryForList(sql, String.class)) {
            brands.add(brand.trim());
        }
        return new ArrayList<>(brands);
    }

    public List<String> getAvailableChannels() {
        String sql = "SELECT DISTINCT Channel FROM Site_Master " +
                "WHERE Sales_Type = 'Secondary Sales' AND Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> ''";
        TreeSet<String> channels = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String channel : jdbcTemplate.queryForList(sql, String.class)) {
            channels.add(normalizeChannelDisplay(channel));
        }
        return new ArrayList<>(channels);
    }

    private Map<String, BigDecimal> siteSales(LocalDate from, LocalDate to) {
        String sql = "SELECT ss.Site_Code, ss.Brand, SUM(ss.Sales) AS total FROM Secondary_Sales ss " +
                "JOIN Product_Master pm ON pm.Article_Code = ss.Article_Code " +
                "WHERE ss.Sales_Date BETWEEN ? AND ? GROUP BY ss.Site_Code, ss.Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> targetBySite(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private record Period(LocalDate salesFrom, LocalDate salesTo, YearMonth fromMonth, YearMonth toMonth,
                           LocalDate lastYearFrom, LocalDate lastYearTo) {
    }

    private Period resolvePeriod(LocalDate from, LocalDate to) {
        LocalDate periodFrom = from;
        LocalDate periodTo = to;
        if (periodFrom == null || periodTo == null) {
            periodFrom = YearMonth.now().atDay(1);
            periodTo = LocalDate.now();
        } else if (periodFrom.isAfter(periodTo)) {
            LocalDate swap = periodFrom;
            periodFrom = periodTo;
            periodTo = swap;
        }
        return new Period(periodFrom, periodTo, YearMonth.from(periodFrom), YearMonth.from(periodTo),
                periodFrom.minusYears(1), periodTo.minusYears(1));
    }

    private static BigDecimal addNullable(BigDecimal sum, BigDecimal addend) {
        if (addend == null) {
            return sum;
        }
        return sum == null ? addend : sum.add(addend);
    }

    private static String normalizeChannelDisplay(String channel) {
        String lower = channel.trim().toLowerCase(Locale.ROOT);
        return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    private static BigDecimal growthPct(BigDecimal current, BigDecimal previous) {
        BigDecimal difference = current.subtract(previous);
        if (previous.compareTo(BigDecimal.ZERO) != 0) {
            return difference.divide(previous, 6, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100))
                    .setScale(2, RoundingMode.HALF_UP);
        }
        if (current.compareTo(BigDecimal.ZERO) == 0) {
            return BigDecimal.ZERO;
        }
        return null;
    }

    private record ChannelGroupResult(BigDecimal totalTarget, BigDecimal totalActual, BigDecimal totalVsLastYear,
                                       List<OverviewCell> channelCells) {
    }

    private ChannelGroupResult buildChannelGroup(String brandLabel, List<String> channels,
                                                  Map<String, List<String>> siteCodesByChannel,
                                                  Map<String, BigDecimal> sales, Map<String, BigDecimal> targetBySite,
                                                  Map<String, BigDecimal> lastYearSales) {
        List<OverviewCell> channelCells = new ArrayList<>();
        BigDecimal groupTarget = null;
        BigDecimal groupActual = BigDecimal.ZERO;
        BigDecimal groupLastYear = BigDecimal.ZERO;

        List<BigDecimal> channelActuals = new ArrayList<>();
        for (String channel : channels) {
            List<String> siteKeys = siteCodesByBrandChannel(siteCodesByChannel, channel);
            BigDecimal target = null;
            BigDecimal actual = BigDecimal.ZERO;
            BigDecimal lastYear = BigDecimal.ZERO;
            for (String key : siteKeys) {
                target = addNullable(target, targetBySite.get(key));
                actual = actual.add(sales.getOrDefault(key, BigDecimal.ZERO));
                lastYear = lastYear.add(lastYearSales.getOrDefault(key, BigDecimal.ZERO));
            }
            channelActuals.add(actual);
            groupTarget = addNullable(groupTarget, target);
            groupActual = groupActual.add(actual);
            groupLastYear = groupLastYear.add(lastYear);
            BigDecimal pctVsTarget = (target != null && target.compareTo(BigDecimal.ZERO) > 0)
                    ? actual.divide(target, 6, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                    : null;
            channelCells.add(new OverviewCell(brandLabel, channel, scale(target), scale(actual),
                    pctVsTarget, growthPct(actual, lastYear), null));
        }

        List<OverviewCell> finalCells = new ArrayList<>();
        for (int i = 0; i < channels.size(); i++) {
            OverviewCell cell = channelCells.get(i);
            BigDecimal sob = groupActual.compareTo(BigDecimal.ZERO) > 0
                    ? channelActuals.get(i).divide(groupActual, 6, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                    : null;
            finalCells.add(new OverviewCell(cell.brand(), cell.channel(), cell.monthTarget(), cell.actualSales(),
                    cell.pctVsTargetPct(), cell.vsLastYearPct(), sob));
        }

        BigDecimal groupPctVsTarget = (groupTarget != null && groupTarget.compareTo(BigDecimal.ZERO) > 0)
                ? groupActual.divide(groupTarget, 6, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                : null;

        BigDecimal groupSob = groupActual.compareTo(BigDecimal.ZERO) > 0 ? new BigDecimal("100.00") : null;
        finalCells.add(new OverviewCell(brandLabel, "Total", scale(groupTarget), scale(groupActual),
                groupPctVsTarget, growthPct(groupActual, groupLastYear), groupSob));

        return new ChannelGroupResult(groupTarget, groupActual, groupLastYear, finalCells);
    }

    private static List<String> siteCodesByBrandChannel(Map<String, List<String>> siteCodesByChannel, String channel) {
        return siteCodesByChannel.getOrDefault(channel, List.of());
    }

    private static BigDecimal scale(BigDecimal value) {
        return value == null ? null : value.setScale(2, RoundingMode.HALF_UP);
    }

    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM Site_Master WHERE Sales_Type = 'Secondary Sales'", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    public OverviewResponse getOverview(LocalDate from, LocalDate to, String brandParam, String channelParam, String status) {
        String brandFilter = BrandFilter.product(BrandFilter.normalize(brandParam));
        String channelFilter = ChannelFilter.normalize(channelParam);

        List<String> brands = getAvailableBrands();
        if (brandFilter != null) {
            brands = brands.stream().filter(b -> b.equalsIgnoreCase(brandFilter)).toList();
        }
        List<String> channels = getAvailableChannels();
        if (channelFilter != null) {
            channels = channels.stream().filter(c -> c.equalsIgnoreCase(channelFilter)).toList();
        }
        if (brands.isEmpty() || channels.isEmpty()) {
            return new OverviewResponse(List.of(), List.of(), List.of());
        }

        List<SiteRow> siteRows = loadSiteRows();
        Period period = resolvePeriod(from, to);
        Map<String, BigDecimal> sales = siteSales(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> targetBySite = targetBySite(period.fromMonth(), period.toMonth());
        Map<String, BigDecimal> lastYearSales = siteSales(period.lastYearFrom(), period.lastYearTo());

        Map<String, Map<String, List<String>>> siteCodesByBrandChannel = new LinkedHashMap<>();
        for (SiteRow site : siteRows) {
            if (site.brand() == null || site.brand().isBlank() || site.channel() == null) {
                continue;
            }
            if (!OperationalStatusFilter.matches(status, site.operationalStatus())) {
                continue;
            }
            siteCodesByBrandChannel.computeIfAbsent(site.brand(), b -> new LinkedHashMap<>())
                    .computeIfAbsent(site.channel(), c -> new ArrayList<>())
                    .add(siteKey(site.siteCode(), site.brand()));
        }

        List<OverviewCell> cells = new ArrayList<>();

        Map<String, List<String>> grandSiteCodesByChannel = new LinkedHashMap<>();
        for (String brand : brands) {
            Map<String, List<String>> siteCodesByChannel = siteCodesByBrandChannel.getOrDefault(brand, Map.of());
            ChannelGroupResult result = buildChannelGroup(brand, channels, siteCodesByChannel, sales, targetBySite, lastYearSales);
            cells.addAll(result.channelCells());
            siteCodesByChannel.forEach((channel, siteCodes) ->
                    grandSiteCodesByChannel.computeIfAbsent(channel, c -> new ArrayList<>()).addAll(siteCodes));
        }

        ChannelGroupResult grandResult = buildChannelGroup("Total", channels, grandSiteCodesByChannel, sales, targetBySite, lastYearSales);
        cells.addAll(grandResult.channelCells());

        return new OverviewResponse(brands, channels, cells);
    }
}
