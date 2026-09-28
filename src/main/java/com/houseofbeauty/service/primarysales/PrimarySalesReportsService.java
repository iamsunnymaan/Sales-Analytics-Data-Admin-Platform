package com.houseofbeauty.service.primarysales;

import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.ChannelFilter;
import com.houseofbeauty.service.common.GrowthMath;
import com.houseofbeauty.service.common.OperationalStatusFilter;
import com.houseofbeauty.service.topprojection.TopProjectionService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

@Service
public class PrimarySalesReportsService {

    private final JdbcTemplate jdbcTemplate;
    private final TopProjectionService topProjectionService;

    public PrimarySalesReportsService(JdbcTemplate jdbcTemplate, TopProjectionService topProjectionService) {
        this.jdbcTemplate = jdbcTemplate;
        this.topProjectionService = topProjectionService;
    }

    private record SiteRow(String siteCode, String brand, String subChannel, String partner, String channel,
                            String operationalStatus) {
    }

    private List<SiteRow> loadSiteRows() {
        List<SiteRow> rows = new ArrayList<>();
        String sql = "SELECT Site_Code, Brand, Sub_Channel, Partner, Channel, Operational_Status FROM Site_Master " +
                "WHERE Sales_Type = 'Primary Sales'";
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            rows.add(new SiteRow(
                    (String) row.get("Site_Code"),
                    orUncategorized((String) row.get("Brand")),
                    orUncategorized((String) row.get("Sub_Channel")),
                    orUncategorized((String) row.get("Partner")),
                    orUncategorized((String) row.get("Channel")),
                    (String) row.get("Operational_Status")));
        }
        return rows;
    }

    private static List<SiteRow> filterByBrand(List<SiteRow> siteRows, String siteMasterBrand) {
        if (siteMasterBrand == null) {
            return siteRows;
        }
        return siteRows.stream().filter(site -> siteMasterBrand.equalsIgnoreCase(site.brand())).toList();
    }

    private Map<String, BigDecimal> targetsByCombo(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Brand, Channel, Partner, SUM(Sales_Target) AS total FROM Primary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Brand, Channel, Partner";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(targetComboKey((String) row.get("Brand"), (String) row.get("Channel"), (String) row.get("Partner")),
                    asDecimal(row.get("total")));
        }
        return result;
    }

    private static String targetComboKey(String brand, String channel, String partner) {
        return normalizeBrandKey(brand) + "|" + normalizeBrandKey(channel) + "|" + normalizeBrandKey(partner);
    }

    private static String normalizeBrandKey(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    public BigDecimal getSiteJoinedSalesSum(LocalDate from, LocalDate to, String brand, String channel, String status) {
        Map<String, BigDecimal> sales = primarySalesBySite(from, to);
        BigDecimal total = BigDecimal.ZERO;
        for (SiteRow site : loadSiteRows()) {
            if (brand != null && !site.brand().equalsIgnoreCase(brand)) {
                continue;
            }
            if (channel != null && !site.channel().equalsIgnoreCase(channel)) {
                continue;
            }
            if (!OperationalStatusFilter.matches(status, site.operationalStatus())) {
                continue;
            }
            total = total.add(sales.getOrDefault(siteKey(site.siteCode(), site.brand()), BigDecimal.ZERO));
        }
        return total;
    }

    public BigDecimal getComboMatchedTargetSum(YearMonth fromMonth, YearMonth toMonth, String brand, String channel, String status) {
        Map<String, BigDecimal> targetsByCombo = targetsByCombo(fromMonth, toMonth);
        Set<String> seenCombos = new HashSet<>();
        BigDecimal total = BigDecimal.ZERO;
        for (SiteRow site : loadSiteRows()) {
            if (brand != null && !site.brand().equalsIgnoreCase(brand)) {
                continue;
            }
            if (channel != null && !site.channel().equalsIgnoreCase(channel)) {
                continue;
            }
            if (!OperationalStatusFilter.matches(status, site.operationalStatus())) {
                continue;
            }
            String comboKey = targetComboKey(site.brand(), normalizeChannelDisplay(site.channel()), site.partner());
            if (seenCombos.add(comboKey)) {
                BigDecimal matched = targetsByCombo.get(comboKey);
                if (matched != null) {
                    total = total.add(matched);
                }
            }
        }
        return total;
    }

    private record Period(LocalDate salesFrom, LocalDate salesTo, YearMonth fromMonth, YearMonth toMonth,
                           LocalDate lastMonthFrom, LocalDate lastMonthTo, LocalDate lastYearFrom, LocalDate lastYearTo) {
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
        LocalDate today = LocalDate.now();
        LocalDate salesTo = periodTo.isAfter(today) ? today : periodTo;
        return new Period(periodFrom, salesTo, YearMonth.from(periodFrom), YearMonth.from(periodTo),
                periodFrom.minusMonths(1), salesTo.minusMonths(1),
                periodFrom.minusYears(1), salesTo.minusYears(1));
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

    private static String orUncategorized(String value) {
        return value == null || value.isBlank() ? "Uncategorized" : value;
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    public List<Map<String, Object>> getBrandHierarchy(LocalDate from, LocalDate to, String brandParam) {
        String normalizedBrand = BrandFilter.normalize(brandParam);
        String siteMasterBrand = BrandFilter.target(normalizedBrand);
        Period period = resolvePeriod(from, to);
        List<SiteRow> siteRows = filterByBrand(loadSiteRows(), siteMasterBrand);
        Map<String, BigDecimal> sales = primarySalesBySite(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> targetsByCombo = targetsByCombo(period.fromMonth(), period.toMonth());
        Map<String, BigDecimal> lastMonthSales = primarySalesBySite(period.lastMonthFrom(), period.lastMonthTo());
        Map<String, BigDecimal> lastYearSales = primarySalesBySite(period.lastYearFrom(), period.lastYearTo());
        Map<String, BigDecimal> projectionsByCombo = topProjectionService.getCurrentMonthProjectionsByCombo();

        Map<String, Map<String, Map<String, Map<String, List<String>>>>> tree = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (SiteRow site : siteRows) {
            tree.computeIfAbsent(site.brand(), b -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(normalizeChannelDisplay(site.channel()), c -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.subChannel(), s -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.partner(), p -> new ArrayList<>())
                    .add(siteKey(site.siteCode(), site.brand()));
        }

        Set<String> seenCombos = new HashSet<>();

        List<Map<String, Object>> brandNodes = new ArrayList<>();
        BigDecimal grandTarget = null;
        BigDecimal grandSales = BigDecimal.ZERO;
        BigDecimal grandLastMonthSales = BigDecimal.ZERO;
        BigDecimal grandLastYearSales = BigDecimal.ZERO;
        BigDecimal grandProjection = BigDecimal.ZERO;
        for (var brandEntry : tree.entrySet()) {
            String brand = brandEntry.getKey();
            List<Map<String, Object>> channelNodes = new ArrayList<>();
            BigDecimal brandTarget = null;
            BigDecimal brandSales = BigDecimal.ZERO;
            BigDecimal brandLastMonthSales = BigDecimal.ZERO;
            BigDecimal brandLastYearSales = BigDecimal.ZERO;
            BigDecimal brandProjection = BigDecimal.ZERO;
            for (var channelEntry : brandEntry.getValue().entrySet()) {
                String channel = channelEntry.getKey();
                List<Map<String, Object>> subChannelNodes = new ArrayList<>();
                BigDecimal channelTarget = null;
                BigDecimal channelSales = BigDecimal.ZERO;
                BigDecimal channelLastMonthSales = BigDecimal.ZERO;
                BigDecimal channelLastYearSales = BigDecimal.ZERO;
                BigDecimal channelProjection = BigDecimal.ZERO;
                for (var subChannelEntry : channelEntry.getValue().entrySet()) {
                    String subChannel = subChannelEntry.getKey();
                    List<Map<String, Object>> partnerNodes = new ArrayList<>();
                    BigDecimal subChannelTarget = null;
                    BigDecimal subChannelSales = BigDecimal.ZERO;
                    BigDecimal subChannelLastMonthSales = BigDecimal.ZERO;
                    BigDecimal subChannelLastYearSales = BigDecimal.ZERO;
                    BigDecimal subChannelProjection = BigDecimal.ZERO;
                    for (var partnerEntry : subChannelEntry.getValue().entrySet()) {
                        String partner = partnerEntry.getKey();
                        BigDecimal partnerSales = BigDecimal.ZERO;
                        BigDecimal partnerLastMonthSales = BigDecimal.ZERO;
                        BigDecimal partnerLastYearSales = BigDecimal.ZERO;
                        for (String key : partnerEntry.getValue()) {
                            partnerSales = partnerSales.add(sales.getOrDefault(key, BigDecimal.ZERO));
                            partnerLastMonthSales = partnerLastMonthSales.add(lastMonthSales.getOrDefault(key, BigDecimal.ZERO));
                            partnerLastYearSales = partnerLastYearSales.add(lastYearSales.getOrDefault(key, BigDecimal.ZERO));
                        }
                        BigDecimal partnerTarget = targetsByCombo.get(targetComboKey(brand, channel, partner));
                        BigDecimal partnerProjection = projectionsByCombo.getOrDefault(
                                TopProjectionService.comboKey(brand, channel, subChannel, partner), BigDecimal.ZERO);
                        partnerNodes.add(node(partner, partnerTarget, partnerSales,
                                GrowthMath.growthPct(partnerSales, partnerLastMonthSales),
                                GrowthMath.growthPct(partnerSales, partnerLastYearSales),
                                partnerProjection,
                                partnerTarget == null ? null : GrowthMath.growthPct(partnerProjection, partnerTarget), null));

                        BigDecimal partnerTargetForRollup = seenCombos.add(targetComboKey(brand, channel, partner))
                                ? partnerTarget : null;
                        subChannelTarget = addNullable(subChannelTarget, partnerTargetForRollup);
                        subChannelSales = subChannelSales.add(partnerSales);
                        subChannelLastMonthSales = subChannelLastMonthSales.add(partnerLastMonthSales);
                        subChannelLastYearSales = subChannelLastYearSales.add(partnerLastYearSales);
                        subChannelProjection = subChannelProjection.add(partnerProjection);
                    }
                    subChannelNodes.add(node(subChannel, subChannelTarget, subChannelSales,
                            GrowthMath.growthPct(subChannelSales, subChannelLastMonthSales),
                            GrowthMath.growthPct(subChannelSales, subChannelLastYearSales),
                            subChannelProjection,
                            subChannelTarget == null ? null : GrowthMath.growthPct(subChannelProjection, subChannelTarget), partnerNodes));
                    channelTarget = addNullable(channelTarget, subChannelTarget);
                    channelSales = channelSales.add(subChannelSales);
                    channelLastMonthSales = channelLastMonthSales.add(subChannelLastMonthSales);
                    channelLastYearSales = channelLastYearSales.add(subChannelLastYearSales);
                    channelProjection = channelProjection.add(subChannelProjection);
                }
                channelNodes.add(node(channel, channelTarget, channelSales,
                        GrowthMath.growthPct(channelSales, channelLastMonthSales),
                        GrowthMath.growthPct(channelSales, channelLastYearSales),
                        channelProjection,
                        channelTarget == null ? null : GrowthMath.growthPct(channelProjection, channelTarget), subChannelNodes));
                brandTarget = addNullable(brandTarget, channelTarget);
                brandSales = brandSales.add(channelSales);
                brandLastMonthSales = brandLastMonthSales.add(channelLastMonthSales);
                brandLastYearSales = brandLastYearSales.add(channelLastYearSales);
                brandProjection = brandProjection.add(channelProjection);
            }
            brandNodes.add(node(brand, brandTarget, brandSales,
                    GrowthMath.growthPct(brandSales, brandLastMonthSales),
                    GrowthMath.growthPct(brandSales, brandLastYearSales),
                    brandProjection, brandTarget == null ? null : GrowthMath.growthPct(brandProjection, brandTarget), channelNodes));
            grandTarget = addNullable(grandTarget, brandTarget);
            grandSales = grandSales.add(brandSales);
            grandLastMonthSales = grandLastMonthSales.add(brandLastMonthSales);
            grandLastYearSales = grandLastYearSales.add(brandLastYearSales);
            grandProjection = grandProjection.add(brandProjection);
        }

        brandNodes.add(node("Total", grandTarget, grandSales,
                GrowthMath.growthPct(grandSales, grandLastMonthSales),
                GrowthMath.growthPct(grandSales, grandLastYearSales),
                grandProjection, grandTarget == null ? null : GrowthMath.growthPct(grandProjection, grandTarget), List.of()));
        return brandNodes;
    }

    public List<Map<String, Object>> getBrandSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::brand, Map.of());
    }

    public List<Map<String, Object>> getChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        String siteMasterBrand = BrandFilter.target(BrandFilter.normalize(brandParam));
        YearMonth currentMonth = YearMonth.now();
        Map<String, BigDecimal> projByChannel =
                topProjectionService.getLatestProjectionsByChannelInRange(currentMonth, currentMonth, siteMasterBrand);
        return getFlatSummary(from, to, brandParam, site -> normalizeChannelDisplay(site.channel()), projByChannel);
    }

    public List<Map<String, Object>> getSubChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        String siteMasterBrand = BrandFilter.target(BrandFilter.normalize(brandParam));
        YearMonth currentMonth = YearMonth.now();
        Map<String, BigDecimal> projBySubChannel =
                topProjectionService.getLatestProjectionsBySubChannelInRange(currentMonth, currentMonth, siteMasterBrand);
        return getFlatSummary(from, to, brandParam, SiteRow::subChannel, projBySubChannel);
    }

    public List<Map<String, Object>> getPartnerSummaries(LocalDate from, LocalDate to, String brandParam) {
        String siteMasterBrand = BrandFilter.target(BrandFilter.normalize(brandParam));
        YearMonth currentMonth = YearMonth.now();
        Map<String, BigDecimal> projByPartner =
                topProjectionService.getLatestProjectionsByPartnerInRange(currentMonth, currentMonth, siteMasterBrand, null);
        return getFlatSummary(from, to, brandParam, SiteRow::partner, projByPartner);
    }

    private List<Map<String, Object>> getFlatSummary(LocalDate from, LocalDate to, String brandParam,
                                                       java.util.function.Function<SiteRow, String> dimensionKey,
                                                       Map<String, BigDecimal> projByDimension) {
        String normalizedBrand = BrandFilter.normalize(brandParam);
        String siteMasterBrand = BrandFilter.target(normalizedBrand);
        Period period = resolvePeriod(from, to);
        List<SiteRow> siteRows = filterByBrand(loadSiteRows(), siteMasterBrand);
        Map<String, BigDecimal> sales = primarySalesBySite(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> targetsByCombo = targetsByCombo(period.fromMonth(), period.toMonth());
        Map<String, BigDecimal> lastMonthSales = primarySalesBySite(period.lastMonthFrom(), period.lastMonthTo());
        Map<String, BigDecimal> lastYearSales = primarySalesBySite(period.lastYearFrom(), period.lastYearTo());

        Map<String, BigDecimal> salesByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, BigDecimal> targetByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, BigDecimal> lastMonthSalesByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, BigDecimal> lastYearSalesByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Set<String> seenCombos = new HashSet<>();
        for (SiteRow site : siteRows) {
            String dimension = dimensionKey.apply(site);
            String key = siteKey(site.siteCode(), site.brand());
            salesByDimension.merge(dimension, sales.getOrDefault(key, BigDecimal.ZERO), BigDecimal::add);
            lastMonthSalesByDimension.merge(dimension, lastMonthSales.getOrDefault(key, BigDecimal.ZERO), BigDecimal::add);
            lastYearSalesByDimension.merge(dimension, lastYearSales.getOrDefault(key, BigDecimal.ZERO), BigDecimal::add);
            String comboKey = targetComboKey(site.brand(), normalizeChannelDisplay(site.channel()), site.partner());
            if (seenCombos.add(comboKey)) {
                BigDecimal matched = targetsByCombo.get(comboKey);
                if (matched != null) {
                    targetByDimension.merge(dimension, matched, BigDecimal::add);
                }
            }
        }

        TreeSet<String> allValues = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        allValues.addAll(salesByDimension.keySet());

        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal grandTarget = null;
        BigDecimal grandSales = BigDecimal.ZERO;
        BigDecimal grandLastMonthSales = BigDecimal.ZERO;
        BigDecimal grandLastYearSales = BigDecimal.ZERO;
        BigDecimal grandProjection = BigDecimal.ZERO;
        for (String dimension : allValues) {
            BigDecimal target = targetByDimension.get(dimension);
            BigDecimal salesTotal = salesByDimension.getOrDefault(dimension, BigDecimal.ZERO);
            BigDecimal lastMonthTotal = lastMonthSalesByDimension.getOrDefault(dimension, BigDecimal.ZERO);
            BigDecimal lastYearTotal = lastYearSalesByDimension.getOrDefault(dimension, BigDecimal.ZERO);
            BigDecimal projection = projByDimension.getOrDefault(dimension, BigDecimal.ZERO);
            grandTarget = addNullable(grandTarget, target);
            grandSales = grandSales.add(salesTotal);
            grandLastMonthSales = grandLastMonthSales.add(lastMonthTotal);
            grandLastYearSales = grandLastYearSales.add(lastYearTotal);
            grandProjection = grandProjection.add(projection);
            rows.add(node(dimension, target, salesTotal,
                    GrowthMath.growthPct(salesTotal, lastMonthTotal), GrowthMath.growthPct(salesTotal, lastYearTotal),
                    projection, target == null ? null : GrowthMath.growthPct(projection, target), null));
        }
        rows.add(node("Total", grandTarget, grandSales,
                GrowthMath.growthPct(grandSales, grandLastMonthSales), GrowthMath.growthPct(grandSales, grandLastYearSales),
                grandProjection, grandTarget == null ? null : GrowthMath.growthPct(grandProjection, grandTarget), null));
        return rows;
    }

    private static Map<String, Object> node(String name, BigDecimal monthTarget, BigDecimal mtdSales,
                                             BigDecimal vsLastMonthPct, BigDecimal vsLastYearPct,
                                             BigDecimal projection, BigDecimal projVsTargetPct, List<Map<String, Object>> states) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("name", name);
        node.put("monthTarget", monthTarget == null ? null : monthTarget.setScale(2, RoundingMode.HALF_UP));
        node.put("mtdSales", mtdSales.setScale(2, RoundingMode.HALF_UP));
        node.put("vsLastMonthPct", vsLastMonthPct);
        node.put("projection", projection == null ? null : projection.setScale(2, RoundingMode.HALF_UP));
        node.put("projVsTargetPct", projVsTargetPct);
        node.put("vsLastYearPct", vsLastYearPct);
        if (states != null) {
            node.put("states", states);
        }
        return node;
    }

    private static String siteKey(String siteCode, String brand) {
        return siteCode + "|" + brand;
    }

    private Map<String, BigDecimal> primarySalesBySite(LocalDate from, LocalDate to) {
        String sql = "SELECT Bill_to, Brand, SUM(Sales) AS total FROM Primary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Bill_to, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Bill_to"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }
}
