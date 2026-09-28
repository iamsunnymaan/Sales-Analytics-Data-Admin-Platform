package com.houseofbeauty.service.secondarysales;

import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.GrowthMath;
import com.houseofbeauty.service.common.OperationalStatusFilter;
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
public class SecondarySalesReportsService {

    private final JdbcTemplate jdbcTemplate;

    public SecondarySalesReportsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private record SiteRow(String siteCode, String brand, String subChannel, String partner, String channel) {
    }

    private List<SiteRow> loadSiteRows() {
        List<SiteRow> rows = new ArrayList<>();
        String sql = "SELECT Site_Code, Brand, Sub_Channel, Partner, Channel FROM Site_Master " +
                "WHERE Sales_Type = 'Secondary Sales'";
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            rows.add(new SiteRow(
                    (String) row.get("Site_Code"),
                    orUncategorized((String) row.get("Brand")),
                    orUncategorized((String) row.get("Sub_Channel")),
                    orUncategorized((String) row.get("Partner")),
                    orUncategorized((String) row.get("Channel"))));
        }
        return rows;
    }

    private static List<SiteRow> filterByBrand(List<SiteRow> siteRows, String siteMasterBrand) {
        if (siteMasterBrand == null) {
            return siteRows;
        }
        return siteRows.stream().filter(site -> siteMasterBrand.equalsIgnoreCase(site.brand())).toList();
    }

    private Map<String, BigDecimal> siteSales(LocalDate from, LocalDate to) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales) AS total FROM Secondary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Site_Code, Brand";
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

    public List<Map<String, Object>> getBrandHierarchy(LocalDate from, LocalDate to, String brandParam) {
        String normalizedBrand = BrandFilter.normalize(brandParam);
        String siteMasterBrand = BrandFilter.target(normalizedBrand);
        Period period = resolvePeriod(from, to);
        List<SiteRow> siteRows = filterByBrand(loadSiteRows(), siteMasterBrand);
        Map<String, BigDecimal> sales = siteSales(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> targetBySite = targetBySite(period.fromMonth(), period.toMonth());
        Map<String, BigDecimal> lastMonthSales = siteSales(period.lastMonthFrom(), period.lastMonthTo());
        Map<String, BigDecimal> lastYearSales = siteSales(period.lastYearFrom(), period.lastYearTo());

        Map<String, Map<String, Map<String, Map<String, List<String>>>>> tree = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (SiteRow site : siteRows) {
            tree.computeIfAbsent(site.brand(), b -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(normalizeChannelDisplay(site.channel()), c -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.subChannel(), s -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.partner(), p -> new ArrayList<>())
                    .add(siteKey(site.siteCode(), site.brand()));
        }

        List<Map<String, Object>> brandNodes = new ArrayList<>();
        BigDecimal grandTarget = null;
        BigDecimal grandSales = BigDecimal.ZERO;
        BigDecimal grandLastMonthSales = BigDecimal.ZERO;
        BigDecimal grandLastYearSales = BigDecimal.ZERO;
        for (var brandEntry : tree.entrySet()) {
            String brand = brandEntry.getKey();
            List<Map<String, Object>> channelNodes = new ArrayList<>();
            BigDecimal brandTarget = null;
            BigDecimal brandSales = BigDecimal.ZERO;
            BigDecimal brandLastMonthSales = BigDecimal.ZERO;
            BigDecimal brandLastYearSales = BigDecimal.ZERO;
            for (var channelEntry : brandEntry.getValue().entrySet()) {
                String channel = channelEntry.getKey();
                List<Map<String, Object>> subChannelNodes = new ArrayList<>();
                BigDecimal channelTarget = null;
                BigDecimal channelSales = BigDecimal.ZERO;
                BigDecimal channelLastMonthSales = BigDecimal.ZERO;
                BigDecimal channelLastYearSales = BigDecimal.ZERO;
                for (var subChannelEntry : channelEntry.getValue().entrySet()) {
                    String subChannel = subChannelEntry.getKey();
                    List<Map<String, Object>> partnerNodes = new ArrayList<>();
                    BigDecimal subChannelTarget = null;
                    BigDecimal subChannelSales = BigDecimal.ZERO;
                    BigDecimal subChannelLastMonthSales = BigDecimal.ZERO;
                    BigDecimal subChannelLastYearSales = BigDecimal.ZERO;
                    for (var partnerEntry : subChannelEntry.getValue().entrySet()) {
                        String partner = partnerEntry.getKey();
                        BigDecimal partnerSales = BigDecimal.ZERO;
                        BigDecimal partnerLastMonthSales = BigDecimal.ZERO;
                        BigDecimal partnerLastYearSales = BigDecimal.ZERO;
                        BigDecimal partnerTarget = null;
                        for (String key : partnerEntry.getValue()) {
                            partnerSales = partnerSales.add(sales.getOrDefault(key, BigDecimal.ZERO));
                            partnerLastMonthSales = partnerLastMonthSales.add(lastMonthSales.getOrDefault(key, BigDecimal.ZERO));
                            partnerLastYearSales = partnerLastYearSales.add(lastYearSales.getOrDefault(key, BigDecimal.ZERO));
                            partnerTarget = addNullable(partnerTarget, targetBySite.get(key));
                        }
                        partnerNodes.add(node(partner, partnerTarget, partnerSales,
                                GrowthMath.growthPct(partnerSales, partnerLastMonthSales),
                                GrowthMath.growthPct(partnerSales, partnerLastYearSales), null));
                        subChannelTarget = addNullable(subChannelTarget, partnerTarget);
                        subChannelSales = subChannelSales.add(partnerSales);
                        subChannelLastMonthSales = subChannelLastMonthSales.add(partnerLastMonthSales);
                        subChannelLastYearSales = subChannelLastYearSales.add(partnerLastYearSales);
                    }
                    subChannelNodes.add(node(subChannel, subChannelTarget, subChannelSales,
                            GrowthMath.growthPct(subChannelSales, subChannelLastMonthSales),
                            GrowthMath.growthPct(subChannelSales, subChannelLastYearSales), partnerNodes));
                    channelTarget = addNullable(channelTarget, subChannelTarget);
                    channelSales = channelSales.add(subChannelSales);
                    channelLastMonthSales = channelLastMonthSales.add(subChannelLastMonthSales);
                    channelLastYearSales = channelLastYearSales.add(subChannelLastYearSales);
                }
                channelNodes.add(node(channel, channelTarget, channelSales,
                        GrowthMath.growthPct(channelSales, channelLastMonthSales),
                        GrowthMath.growthPct(channelSales, channelLastYearSales), subChannelNodes));
                brandTarget = addNullable(brandTarget, channelTarget);
                brandSales = brandSales.add(channelSales);
                brandLastMonthSales = brandLastMonthSales.add(channelLastMonthSales);
                brandLastYearSales = brandLastYearSales.add(channelLastYearSales);
            }
            brandNodes.add(node(brand, brandTarget, brandSales,
                    GrowthMath.growthPct(brandSales, brandLastMonthSales),
                    GrowthMath.growthPct(brandSales, brandLastYearSales), channelNodes));
            grandTarget = addNullable(grandTarget, brandTarget);
            grandSales = grandSales.add(brandSales);
            grandLastMonthSales = grandLastMonthSales.add(brandLastMonthSales);
            grandLastYearSales = grandLastYearSales.add(brandLastYearSales);
        }

        brandNodes.add(node("Total", grandTarget, grandSales,
                GrowthMath.growthPct(grandSales, grandLastMonthSales),
                GrowthMath.growthPct(grandSales, grandLastYearSales), List.of()));
        return brandNodes;
    }

    private static BigDecimal addNullable(BigDecimal sum, BigDecimal addend) {
        if (addend == null) {
            return sum;
        }
        return sum == null ? addend : sum.add(addend);
    }

    public List<Map<String, Object>> getChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, site -> normalizeChannelDisplay(site.channel()));
    }

    public List<Map<String, Object>> getBrandSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::brand);
    }

    public List<Map<String, Object>> getSubChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::subChannel);
    }

    public List<Map<String, Object>> getPartnerSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::partner);
    }

    private List<Map<String, Object>> getFlatSummary(LocalDate from, LocalDate to, String brandParam,
                                                       java.util.function.Function<SiteRow, String> dimensionKey) {
        String normalizedBrand = BrandFilter.normalize(brandParam);
        String siteMasterBrand = BrandFilter.target(normalizedBrand);
        Period period = resolvePeriod(from, to);
        List<SiteRow> siteRows = filterByBrand(loadSiteRows(), siteMasterBrand);
        Map<String, BigDecimal> sales = siteSales(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> targetBySite = targetBySite(period.fromMonth(), period.toMonth());
        Map<String, BigDecimal> lastMonthSales = siteSales(period.lastMonthFrom(), period.lastMonthTo());
        Map<String, BigDecimal> lastYearSales = siteSales(period.lastYearFrom(), period.lastYearTo());

        Map<String, BigDecimal> salesByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, BigDecimal> targetByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, BigDecimal> lastMonthSalesByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, BigDecimal> lastYearSalesByDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (SiteRow site : siteRows) {
            String key = dimensionKey.apply(site);
            String siteMapKey = siteKey(site.siteCode(), site.brand());
            salesByDimension.merge(key, sales.getOrDefault(siteMapKey, BigDecimal.ZERO), BigDecimal::add);
            lastMonthSalesByDimension.merge(key, lastMonthSales.getOrDefault(siteMapKey, BigDecimal.ZERO), BigDecimal::add);
            lastYearSalesByDimension.merge(key, lastYearSales.getOrDefault(siteMapKey, BigDecimal.ZERO), BigDecimal::add);
            BigDecimal siteTarget = targetBySite.get(siteMapKey);
            if (siteTarget != null) {
                targetByDimension.put(key, addNullable(targetByDimension.get(key), siteTarget));
            }
        }

        TreeSet<String> allValues = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        allValues.addAll(salesByDimension.keySet());

        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal grandTarget = null;
        BigDecimal grandSales = BigDecimal.ZERO;
        BigDecimal grandLastMonthSales = BigDecimal.ZERO;
        BigDecimal grandLastYearSales = BigDecimal.ZERO;
        for (String value : allValues) {
            BigDecimal target = targetByDimension.get(value);
            BigDecimal salesTotal = salesByDimension.getOrDefault(value, BigDecimal.ZERO);
            BigDecimal lastMonthTotal = lastMonthSalesByDimension.getOrDefault(value, BigDecimal.ZERO);
            BigDecimal lastYearTotal = lastYearSalesByDimension.getOrDefault(value, BigDecimal.ZERO);
            grandTarget = addNullable(grandTarget, target);
            grandSales = grandSales.add(salesTotal);
            grandLastMonthSales = grandLastMonthSales.add(lastMonthTotal);
            grandLastYearSales = grandLastYearSales.add(lastYearTotal);
            rows.add(node(value, target, salesTotal,
                    GrowthMath.growthPct(salesTotal, lastMonthTotal), GrowthMath.growthPct(salesTotal, lastYearTotal), null));
        }
        rows.add(node("Total", grandTarget, grandSales,
                GrowthMath.growthPct(grandSales, grandLastMonthSales), GrowthMath.growthPct(grandSales, grandLastYearSales), null));
        return rows;
    }

    private static Map<String, Object> node(String name, BigDecimal monthTarget, BigDecimal mtdSales,
                                             BigDecimal vsLastMonthPct, BigDecimal vsLastYearPct,
                                             List<Map<String, Object>> states) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("name", name);
        node.put("monthTarget", monthTarget == null ? null : monthTarget.setScale(2, RoundingMode.HALF_UP));
        node.put("mtdSales", mtdSales.setScale(2, RoundingMode.HALF_UP));
        node.put("vsLastMonthPct", vsLastMonthPct);
        node.put("vsLastYearPct", vsLastYearPct);
        if (states != null) {
            node.put("states", states);
        }
        return node;
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

    private record SecondarySaleSiteInfo(String siteCode, String brand, String storeName, String city,
                                          String state, String region, String channel, String operationalStatus) {
    }

    private static String siteKey(String siteCode, String brand) {
        return siteCode + "|" + brand;
    }

    private List<SecondarySaleSiteInfo> loadSecondarySaleSiteMasterInfo() {
        List<SecondarySaleSiteInfo> rows = new ArrayList<>();
        String sql = "SELECT Site_Code, Brand, Store_Name, City, State, Region, Channel, Operational_Status " +
                "FROM site_master WHERE Sales_Type = 'Secondary Sales' ORDER BY Site_Code, Brand";
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            rows.add(new SecondarySaleSiteInfo((String) row.get("Site_Code"), (String) row.get("Brand"),
                    orUncategorized((String) row.get("Store_Name")),
                    orUncategorized((String) row.get("City")),
                    orUncategorized((String) row.get("State")),
                    orUncategorized((String) row.get("Region")),
                    orUncategorized((String) row.get("Channel")),
                    (String) row.get("Operational_Status")));
        }
        return rows;
    }

    private Map<String, BigDecimal> secondarySalesByBrandSite(LocalDate from, LocalDate to) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales) AS total FROM Secondary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> secondaryTargetByBrandSite(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    public List<Map<String, Object>> getSiteMasterSecondarySaleReport(LocalDate from, LocalDate to, String brand, String channel, String status) {
        Period period = resolvePeriod(from, to);

        List<SecondarySaleSiteInfo> siteRows = loadSecondarySaleSiteMasterInfo().stream()
                .filter(site -> brand == null || brand.equalsIgnoreCase(site.brand()))
                .filter(site -> channel == null || channel.equalsIgnoreCase(site.channel()))
                .filter(site -> OperationalStatusFilter.matches(status, site.operationalStatus()))
                .toList();
        Map<String, BigDecimal> sales = secondarySalesByBrandSite(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> lastYearSales = secondarySalesByBrandSite(period.lastYearFrom(), period.lastYearTo());
        Map<String, BigDecimal> target = secondaryTargetByBrandSite(period.fromMonth(), period.toMonth());

        record Row(SecondarySaleSiteInfo info, BigDecimal actualSales, BigDecimal lastYearSales) {
        }
        List<Row> rows = siteRows.stream()
                .map(site -> {
                    String key = siteKey(site.siteCode(), site.brand());
                    return new Row(site, sales.getOrDefault(key, BigDecimal.ZERO),
                            lastYearSales.getOrDefault(key, BigDecimal.ZERO));
                })
                .sorted(Comparator.comparing(Row::actualSales).reversed())
                .toList();

        List<Map<String, Object>> result = new ArrayList<>();
        int rank = 1;
        BigDecimal grandTarget = null;
        BigDecimal grandSales = BigDecimal.ZERO;
        BigDecimal grandLastYearSales = BigDecimal.ZERO;
        Set<String> distinctBrands = new HashSet<>();
        Set<String> distinctCities = new HashSet<>();
        Set<String> distinctStates = new HashSet<>();
        Set<String> distinctRegions = new HashSet<>();
        for (Row row : rows) {
            SecondarySaleSiteInfo site = row.info();
            distinctBrands.add(site.brand());
            distinctCities.add(site.city());
            distinctStates.add(site.state());
            distinctRegions.add(site.region());
            String key = siteKey(site.siteCode(), site.brand());
            BigDecimal siteTarget = target.get(key);

            Map<String, Object> node = new LinkedHashMap<>();
            node.put("rank", rank++);
            node.put("siteCode", site.siteCode());
            node.put("brand", site.brand());
            node.put("storeName", site.storeName());
            node.put("city", site.city());
            node.put("state", site.state());
            node.put("region", site.region());
            node.put("monthTarget", siteTarget == null ? null : siteTarget.setScale(2, RoundingMode.HALF_UP));
            node.put("actualSales", row.actualSales().setScale(2, RoundingMode.HALF_UP));
            node.put("vsLastYearPct", GrowthMath.growthPct(row.actualSales(), row.lastYearSales()));
            result.add(node);

            grandTarget = addNullable(grandTarget, siteTarget);
            grandSales = grandSales.add(row.actualSales());
            grandLastYearSales = grandLastYearSales.add(row.lastYearSales());
        }

        Map<String, Object> totalNode = new LinkedHashMap<>();
        totalNode.put("rank", null);
        totalNode.put("siteCode", null);
        totalNode.put("totalCount", rows.size());
        totalNode.put("brand", null);
        totalNode.put("brandCount", distinctBrands.size());
        totalNode.put("storeName", null);
        totalNode.put("city", null);
        totalNode.put("cityCount", distinctCities.size());
        totalNode.put("state", null);
        totalNode.put("stateCount", distinctStates.size());
        totalNode.put("region", null);
        totalNode.put("regionCount", distinctRegions.size());
        totalNode.put("monthTarget", grandTarget == null ? null : grandTarget.setScale(2, RoundingMode.HALF_UP));
        totalNode.put("actualSales", grandSales.setScale(2, RoundingMode.HALF_UP));
        totalNode.put("vsLastYearPct", GrowthMath.growthPct(grandSales, grandLastYearSales));
        result.add(totalNode);

        return result;
    }
}
