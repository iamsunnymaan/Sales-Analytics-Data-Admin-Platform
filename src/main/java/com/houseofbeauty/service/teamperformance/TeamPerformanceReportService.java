package com.houseofbeauty.service.teamperformance;

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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;

@Service
public class TeamPerformanceReportService {

    private final JdbcTemplate jdbcTemplate;
    private final TeamSiteRepository teamSiteRepository;

    public TeamPerformanceReportService(JdbcTemplate jdbcTemplate, TeamSiteRepository teamSiteRepository) {
        this.jdbcTemplate = jdbcTemplate;
        this.teamSiteRepository = teamSiteRepository;
    }

    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM site_master", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    public List<String> getAvailableSalesTypes() {
        String sql = "SELECT DISTINCT Sales_Type FROM site_master WHERE Sales_Type IS NOT NULL AND LTRIM(RTRIM(Sales_Type)) <> ''";
        java.util.TreeSet<String> types = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String type : jdbcTemplate.queryForList(sql, String.class)) {
            types.add(type.trim());
        }
        return new ArrayList<>(types);
    }

    private static boolean isPrimarySite(TeamSiteRow site) {
        return site.salesType() != null && site.salesType().toLowerCase(Locale.ROOT).contains("primary");
    }

    private static String siteKey(String siteCode, String brand) {
        return siteCode + "|" + brand;
    }

    private static String normalizeBrandKey(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String targetComboKey(String brand, String channel, String partner) {
        return normalizeBrandKey(brand) + "|" + normalizeBrandKey(channel) + "|" + normalizeBrandKey(partner);
    }

    private static String orUncategorized(String value) {
        return value == null || value.isBlank() ? "Uncategorized" : value;
    }

    private Map<String, BigDecimal> primarySalesBySite(LocalDate from, LocalDate to) {
        String sql = "SELECT Bill_to, Brand, SUM(Sales) AS total FROM Primary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Bill_to, Brand";
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Bill_to"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> secondarySalesBySite(LocalDate from, LocalDate to) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales) AS total FROM Secondary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> secondaryTargetBySite(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> primaryTargetsByCombo(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Brand, Channel, Partner, SUM(Sales_Target) AS total FROM Primary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Brand, Channel, Partner";
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(targetComboKey((String) row.get("Brand"), (String) row.get("Channel"), (String) row.get("Partner")),
                    asDecimal(row.get("total")));
        }
        return result;
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    private static BigDecimal addNullable(BigDecimal sum, BigDecimal addend) {
        if (addend == null) {
            return sum;
        }
        return sum == null ? addend : sum.add(addend);
    }

    private record Period(LocalDate salesFrom, LocalDate salesTo, YearMonth fromMonth, YearMonth toMonth,
                           LocalDate lastMonthFrom, LocalDate lastMonthTo,
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
        LocalDate today = LocalDate.now();
        LocalDate salesTo = periodTo.isAfter(today) ? today : periodTo;
        return new Period(periodFrom, salesTo, YearMonth.from(periodFrom), YearMonth.from(periodTo),
                periodFrom.minusMonths(1), salesTo.minusMonths(1),
                periodFrom.minusYears(1), salesTo.minusYears(1));
    }

    private record DataSet(Map<String, BigDecimal> primarySales, Map<String, BigDecimal> secondarySales,
                            Map<String, BigDecimal> primaryLastMonthSales, Map<String, BigDecimal> secondaryLastMonthSales,
                            Map<String, BigDecimal> primaryLastYearSales, Map<String, BigDecimal> secondaryLastYearSales,
                            Map<String, BigDecimal> secondaryTargets, Map<String, BigDecimal> primaryTargetsByCombo) {
    }

    private DataSet loadDataSet(Period period) {
        return new DataSet(
                primarySalesBySite(period.salesFrom(), period.salesTo()),
                secondarySalesBySite(period.salesFrom(), period.salesTo()),
                primarySalesBySite(period.lastMonthFrom(), period.lastMonthTo()),
                secondarySalesBySite(period.lastMonthFrom(), period.lastMonthTo()),
                primarySalesBySite(period.lastYearFrom(), period.lastYearTo()),
                secondarySalesBySite(period.lastYearFrom(), period.lastYearTo()),
                secondaryTargetBySite(period.fromMonth(), period.toMonth()),
                primaryTargetsByCombo(period.fromMonth(), period.toMonth()));
    }

    private record NodeAgg(int sites, BigDecimal sales, BigDecimal lastMonthSales, BigDecimal lastYearSales,
                            BigDecimal target) {
    }

    private static NodeAgg aggregateSites(List<TeamSiteRow> sites, DataSet data) {
        BigDecimal sales = BigDecimal.ZERO;
        BigDecimal lastMonthSales = BigDecimal.ZERO;
        BigDecimal lastYearSales = BigDecimal.ZERO;
        BigDecimal target = null;
        Set<String> seenCombos = new HashSet<>();
        for (TeamSiteRow site : sites) {
            String key = siteKey(site.siteCode(), site.brand());
            if (isPrimarySite(site)) {
                sales = sales.add(data.primarySales().getOrDefault(key, BigDecimal.ZERO));
                lastMonthSales = lastMonthSales.add(data.primaryLastMonthSales().getOrDefault(key, BigDecimal.ZERO));
                lastYearSales = lastYearSales.add(data.primaryLastYearSales().getOrDefault(key, BigDecimal.ZERO));
                String comboKey = targetComboKey(site.brand(), site.channel(), site.partner());
                if (seenCombos.add(comboKey)) {
                    target = addNullable(target, data.primaryTargetsByCombo().get(comboKey));
                }
            } else {
                sales = sales.add(data.secondarySales().getOrDefault(key, BigDecimal.ZERO));
                lastMonthSales = lastMonthSales.add(data.secondaryLastMonthSales().getOrDefault(key, BigDecimal.ZERO));
                lastYearSales = lastYearSales.add(data.secondaryLastYearSales().getOrDefault(key, BigDecimal.ZERO));
                target = addNullable(target, data.secondaryTargets().get(key));
            }
        }
        return new NodeAgg(sites.size(), sales, lastMonthSales, lastYearSales, target);
    }

    private static Map<String, Object> node(String name, int sites, BigDecimal target, BigDecimal sales,
                                             BigDecimal vsLastMonthPct, BigDecimal vsLastYearPct,
                                             List<Map<String, Object>> children) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("name", name);
        node.put("sites", sites);
        node.put("target", target == null ? null : target.setScale(2, RoundingMode.HALF_UP));
        node.put("sales", sales.setScale(2, RoundingMode.HALF_UP));
        node.put("vsLastMonthPct", vsLastMonthPct);
        node.put("vsLastYearPct", vsLastYearPct);
        if (children != null) {
            node.put("children", children);
        }
        return node;
    }

    private static Map<String, Object> nodeFrom(String name, List<TeamSiteRow> sites, DataSet data,
                                                 List<Map<String, Object>> children) {
        NodeAgg agg = aggregateSites(sites, data);
        return node(name, agg.sites(), agg.target(), agg.sales(),
                GrowthMath.growthPct(agg.sales(), agg.lastMonthSales()),
                GrowthMath.growthPct(agg.sales(), agg.lastYearSales()), children);
    }

    public List<Map<String, Object>> getPositionHierarchy(LocalDate from, LocalDate to, String salesType, String status) {
        Period period = resolvePeriod(from, to);
        DataSet data = loadDataSet(period);
        List<TeamSiteRow> siteRows = teamSiteRepository.loadSiteRows(
                TeamSiteRepository.resolveSalesTypeFilter(salesType), status, null, null);

        Map<String, Map<String, Map<String, Map<String, List<TeamSiteRow>>>>> tree =
                new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (TeamSiteRow site : siteRows) {
            tree.computeIfAbsent(site.rm(), k -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.am(), k -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.cm(), k -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.sm(), k -> new ArrayList<>())
                    .add(site);
        }

        List<Map<String, Object>> rmNodes = new ArrayList<>();
        List<TeamSiteRow> allSites = new ArrayList<>();
        for (var rmEntry : tree.entrySet()) {
            List<Map<String, Object>> amNodes = new ArrayList<>();
            List<TeamSiteRow> rmSites = new ArrayList<>();
            for (var amEntry : rmEntry.getValue().entrySet()) {
                List<Map<String, Object>> cmNodes = new ArrayList<>();
                List<TeamSiteRow> amSites = new ArrayList<>();
                for (var cmEntry : amEntry.getValue().entrySet()) {
                    List<Map<String, Object>> smNodes = new ArrayList<>();
                    List<TeamSiteRow> cmSites = new ArrayList<>();
                    for (var smEntry : cmEntry.getValue().entrySet()) {
                        List<TeamSiteRow> smSites = smEntry.getValue();
                        smNodes.add(nodeFrom(smEntry.getKey(), smSites, data, null));
                        cmSites.addAll(smSites);
                    }
                    cmNodes.add(nodeFrom(cmEntry.getKey(), cmSites, data, smNodes));
                    amSites.addAll(cmSites);
                }
                amNodes.add(nodeFrom(amEntry.getKey(), amSites, data, cmNodes));
                rmSites.addAll(amSites);
            }
            rmNodes.add(nodeFrom(rmEntry.getKey(), rmSites, data, amNodes));
            allSites.addAll(rmSites);
        }
        rmNodes.add(nodeFrom("Total", allSites, data, List.of()));
        return rmNodes;
    }

    private List<Map<String, Object>> getFlatPositionSummary(LocalDate from, LocalDate to, String salesType, String status,
                                                               Function<TeamSiteRow, String> dimensionKey) {
        Period period = resolvePeriod(from, to);
        DataSet data = loadDataSet(period);
        List<TeamSiteRow> siteRows = teamSiteRepository.loadSiteRows(
                TeamSiteRepository.resolveSalesTypeFilter(salesType), status, null, null);

        Map<String, List<TeamSiteRow>> byDimension = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (TeamSiteRow site : siteRows) {
            byDimension.computeIfAbsent(dimensionKey.apply(site), k -> new ArrayList<>()).add(site);
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        List<TeamSiteRow> allSites = new ArrayList<>();
        for (var entry : byDimension.entrySet()) {
            rows.add(nodeFrom(entry.getKey(), entry.getValue(), data, null));
            allSites.addAll(entry.getValue());
        }
        rows.add(nodeFrom("Total", allSites, data, null));
        return rows;
    }

    public List<Map<String, Object>> getAmSummaries(LocalDate from, LocalDate to, String salesType, String status) {
        return getFlatPositionSummary(from, to, salesType, status, TeamSiteRow::am);
    }

    public List<Map<String, Object>> getCmSummaries(LocalDate from, LocalDate to, String salesType, String status) {
        return getFlatPositionSummary(from, to, salesType, status, TeamSiteRow::cm);
    }

    public List<Map<String, Object>> getSmSummaries(LocalDate from, LocalDate to, String salesType, String status) {
        return getFlatPositionSummary(from, to, salesType, status, TeamSiteRow::sm);
    }

    private record TeamSiteReportInfo(String siteCode, String brand, String storeName, String city, String state,
                                       String region, String salesType, String channel, String partner) {
    }

    private List<TeamSiteReportInfo> loadSiteReportInfo(String levelColumn, String name, String status) {
        String sql = "SELECT Site_Code, Brand, Store_Name, City, State, Region, Sales_Type, Channel, Partner " +
                "FROM site_master WHERE " + levelColumn + " = ?" + OperationalStatusFilter.whereClause(status) +
                " ORDER BY Site_Code, Brand";
        List<TeamSiteReportInfo> rows = new ArrayList<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, name)) {
            rows.add(new TeamSiteReportInfo(
                    (String) row.get("Site_Code"),
                    (String) row.get("Brand"),
                    orUncategorized((String) row.get("Store_Name")),
                    orUncategorized((String) row.get("City")),
                    orUncategorized((String) row.get("State")),
                    orUncategorized((String) row.get("Region")),
                    (String) row.get("Sales_Type"),
                    (String) row.get("Channel"),
                    (String) row.get("Partner")));
        }
        return rows;
    }

    public List<Map<String, Object>> getSiteMasterReport(LocalDate from, LocalDate to, String level, String name, String status) {
        String levelColumn = TeamSiteRepository.requireLevelColumn(level);
        Period period = resolvePeriod(from, to);
        List<TeamSiteReportInfo> siteRows = loadSiteReportInfo(levelColumn, name, status);

        Map<String, BigDecimal> primarySales = primarySalesBySite(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> secondarySales = secondarySalesBySite(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> primaryLastYearSales = primarySalesBySite(period.lastYearFrom(), period.lastYearTo());
        Map<String, BigDecimal> secondaryLastYearSales = secondarySalesBySite(period.lastYearFrom(), period.lastYearTo());
        Map<String, BigDecimal> secondaryTargets = secondaryTargetBySite(period.fromMonth(), period.toMonth());
        Map<String, BigDecimal> primaryTargetsByCombo = primaryTargetsByCombo(period.fromMonth(), period.toMonth());

        record Row(TeamSiteReportInfo info, boolean isPrimary, BigDecimal sales, BigDecimal lastYearSales, BigDecimal target) {
        }
        List<Row> rows = siteRows.stream()
                .map(site -> {
                    String key = siteKey(site.siteCode(), site.brand());
                    boolean isPrimary = site.salesType() != null && site.salesType().toLowerCase(Locale.ROOT).contains("primary");
                    BigDecimal sales = isPrimary
                            ? primarySales.getOrDefault(key, BigDecimal.ZERO)
                            : secondarySales.getOrDefault(key, BigDecimal.ZERO);
                    BigDecimal lastYearSales = isPrimary
                            ? primaryLastYearSales.getOrDefault(key, BigDecimal.ZERO)
                            : secondaryLastYearSales.getOrDefault(key, BigDecimal.ZERO);
                    BigDecimal target = isPrimary
                            ? primaryTargetsByCombo.get(targetComboKey(site.brand(), site.channel(), site.partner()))
                            : secondaryTargets.get(key);
                    return new Row(site, isPrimary, sales, lastYearSales, target);
                })
                .sorted(Comparator.comparing(Row::sales).reversed())
                .toList();

        List<Map<String, Object>> result = new ArrayList<>();
        int rank = 1;
        BigDecimal grandTarget = null;
        BigDecimal grandSales = BigDecimal.ZERO;
        BigDecimal grandLastYearSales = BigDecimal.ZERO;
        Set<String> seenPrimaryCombos = new HashSet<>();
        Set<String> distinctBrands = new HashSet<>();
        Set<String> distinctCities = new HashSet<>();
        Set<String> distinctStates = new HashSet<>();
        Set<String> distinctRegions = new HashSet<>();
        for (Row row : rows) {
            TeamSiteReportInfo site = row.info();
            distinctBrands.add(site.brand());
            distinctCities.add(site.city());
            distinctStates.add(site.state());
            distinctRegions.add(site.region());

            Map<String, Object> node = new LinkedHashMap<>();
            node.put("rank", rank++);
            node.put("siteCode", site.siteCode());
            node.put("brand", site.brand());
            node.put("storeName", site.storeName());
            node.put("city", site.city());
            node.put("state", site.state());
            node.put("region", site.region());
            node.put("target", row.target() == null ? null : row.target().setScale(2, RoundingMode.HALF_UP));
            node.put("sales", row.sales().setScale(2, RoundingMode.HALF_UP));
            node.put("vsLastYearPct", GrowthMath.growthPct(row.sales(), row.lastYearSales()));
            result.add(node);

            if (row.isPrimary()) {
                String comboKey = targetComboKey(site.brand(), site.channel(), site.partner());
                if (seenPrimaryCombos.add(comboKey)) {
                    grandTarget = addNullable(grandTarget, row.target());
                }
            } else {
                grandTarget = addNullable(grandTarget, row.target());
            }
            grandSales = grandSales.add(row.sales());
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
        totalNode.put("target", grandTarget == null ? null : grandTarget.setScale(2, RoundingMode.HALF_UP));
        totalNode.put("sales", grandSales.setScale(2, RoundingMode.HALF_UP));
        totalNode.put("vsLastYearPct", GrowthMath.growthPct(grandSales, grandLastYearSales));
        result.add(totalNode);

        return result;
    }
}
