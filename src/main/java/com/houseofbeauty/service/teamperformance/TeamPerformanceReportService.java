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

// Backs the Team Insights page's own "Team Report" section — exact frontend/backend architecture
// mirror of PrimarySalesReportsService's own "4. Reports" (getBrandHierarchy/getFlatSummary), per
// explicit request: an "All Report" hierarchy tree (RM -> AM -> CM -> SM, RM the root) plus three
// flat single-level tabs (AM/CM/SM — RM excluded from the flat tabs since it's already the tree's
// root, same reasoning Primary's own Brand is excluded from its flat tabs). Unlike Primary's
// Brand/Channel/Sub_Channel/Partner (four INDEPENDENT dimensions), RM/AM/CM/SM are four hierarchy
// LAYERS of the same site row — so unlike Primary's tree (where a leaf's own (Brand,Channel,Partner)
// combo IS its grouping key, letting Target be looked up once per leaf), an SM leaf here can span
// several different real (Brand,Channel,Partner) combos, and the very same combo can independently
// reappear under a different SM/CM/AM/RM elsewhere — so every node's own Target here is computed
// fresh from its own full subtree's site list (aggregateSites), deduping combos scoped to just that
// subtree, rather than by summing already-rolled-up child values.
//
// A site's real Sales/Target live in Primary_Sales(+Target) or Secondary_Sales(+Target) depending on
// that site's own Sales_Type — same real-classification convention
// PrimarySalesReportsService/SecondarySalesReportsService's own Site Master Reports use — so this
// service pulls from BOTH tables instead of being scoped to one, unlike those two, UNLESS the
// frontend's own Primary/Secondary sales-type pill (default Secondary, see TeamPerformancePage.js)
// narrows every query down to just one — see TeamSiteRepository.resolveSalesTypeFilter. Site rows
// themselves come from the shared TeamSiteRepository, scoped by the Filter Header's own Status
// toggle pill (`status` — "all"/"active"/"inactive"/"upcoming", defaults to "active", this class's
// own previous hardcoded-Active-only behavior — see TeamSiteRepository's own header comment), not a
// private query.
@Service
public class TeamPerformanceReportService {

    private final JdbcTemplate jdbcTemplate;
    private final TeamSiteRepository teamSiteRepository;

    public TeamPerformanceReportService(JdbcTemplate jdbcTemplate, TeamSiteRepository teamSiteRepository) {
        this.jdbcTemplate = jdbcTemplate;
        this.teamSiteRepository = teamSiteRepository;
    }

    // Status pill options — backs the Filter Header's own Status pill (GET /api/team-performance/statuses),
    // fetched the same "real Site_Master round-trip, not a hardcoded return" convention
    // DashboardOverviewService.getAvailableStatuses/SiteStatusService.getAvailableStatuses already use,
    // instead of the pill's All/Active/Inactive/Upcoming buttons being hardcoded straight into
    // TeamPerformancePage.html. The category list itself (Active/Inactive/Upcoming) is the same fixed,
    // app-wide Site Status vocabulary OperationalStatusFilter classifies against — NOT derived from
    // Site_Master's own live distinct Operational_Status text (that column is free text with no
    // canonical enumeration to query). An empty/not-yet-imported Site_Master (count 0) or a genuine
    // DB-connectivity problem (query throws) both fall back to an empty list here, letting the frontend
    // show the same "Not Available" state every other pill's own fetch failure already shows.
    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM site_master", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    // Sales Type pill options — backs the Filter Header's own Sales Type pill
    // (GET /api/team-performance/sales-types), real distinct site_master.Sales_Type values ("Primary
    // Sales"/"Secondary Sales" today) instead of the pill's Primary/Secondary buttons being hardcoded
    // straight into TeamPerformancePage.html — same query DashboardOverviewService's own
    // getAvailableSalesTypes/SiteStatusService's own getAvailableSalesTypes use. Naturally falls back
    // to an empty list (frontend shows "Not Available") when site_master has no usable Sales_Type
    // data yet, and a genuine DB-connectivity problem surfaces as a thrown exception the same way.
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

    // Real (Bill_to, Brand)-keyed Primary_Sales sum for [from, to].
    private Map<String, BigDecimal> primarySalesBySite(LocalDate from, LocalDate to) {
        String sql = "SELECT Bill_to, Brand, SUM(Sales) AS total FROM Primary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Bill_to, Brand";
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Bill_to"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // Real (Site_Code, Brand)-keyed Secondary_Sales sum for [from, to].
    private Map<String, BigDecimal> secondarySalesBySite(LocalDate from, LocalDate to) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales) AS total FROM Secondary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // Real (Site_Code, Brand)-keyed Secondary_Sales_Target sum for [fromMonth, toMonth] — genuinely
    // per-site grain, no combo-match needed (unlike Primary_Sales_Target below).
    private Map<String, BigDecimal> secondaryTargetBySite(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // Real (Brand, Channel, Partner)-combo Primary_Sales_Target sum for [fromMonth, toMonth] — NOT
    // per-Site_Code (Primary_Sales_Target carries a full Partner x Channel x Brand cross-product per
    // site/month, not one real per-site row — see PrimarySalesReportsService's own header comment for
    // the live-verified detail), so this is combo-matched and dedup'd per node below instead.
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

    // lastMonth*/lastYear* are the exact same [salesFrom, salesTo] window shifted back a calendar
    // month/year, same convention PrimarySalesReportsService's own Period uses for its "4. Reports"
    // Vs LM/Vs LY.
    private record Period(LocalDate salesFrom, LocalDate salesTo, YearMonth fromMonth, YearMonth toMonth,
                           LocalDate lastMonthFrom, LocalDate lastMonthTo,
                           LocalDate lastYearFrom, LocalDate lastYearTo) {
    }

    // `from`/`to` default to the current calendar month-to-date when either is omitted, same
    // convention used across the rest of this app's date-scoped endpoints.
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

    // Every (Sales/Target/Vs LM/Vs LY-feeding) map this service needs, bundled once per request so
    // aggregateSites/getPositionHierarchy/getFlatPositionSummary don't each re-fetch them.
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

    // Computes one node's own Sites/Sales/Vs LM/Vs LY/Target fresh from its own full member site
    // list — NOT by summing already-computed child nodes — so Target's (Brand, Channel, Partner)
    // combo dedup is always scoped correctly to exactly this node's own subtree (see this class's own
    // header comment for why that matters here, unlike Primary's simpler tree).
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

    // "All Report" tab: real RM -> AM -> CM -> SM tree (SM is the leaf) — exact structural mirror of
    // PrimarySalesReportsService#getBrandHierarchy's Brand -> Channel -> Sub_Channel -> Partner tree,
    // just one hierarchy dimension deep instead of four independent ones. Every node's own
    // Sites/Target/Sales/Vs LM/Vs LY is computed fresh from its own full subtree (see aggregateSites)
    // rather than added up from pre-computed children, so a (Brand, Channel, Partner) combo shared
    // across two different branches of the SAME node's subtree is never double-counted.
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

    // Shared by every flat (single-level) Reports tab (AM/CM/SM) — one row per distinct real
    // RM/AM/CM/SM value `dimensionKey` returns, ignoring the other 3 levels entirely (unlike the
    // tree, this flattens straight across every site regardless of who else is in its chain) — exact
    // mirror of PrimarySalesReportsService#getFlatSummary.
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

    // "AM" tab — flat one-row-per-AM summary. Per Primary's own convention (its Brand tab is
    // similarly excluded), RM is NOT wired into the frontend's tab toggle — RM-level rows are already
    // visible via the "All Report" hierarchy tree's own top level.
    public List<Map<String, Object>> getAmSummaries(LocalDate from, LocalDate to, String salesType, String status) {
        return getFlatPositionSummary(from, to, salesType, status, TeamSiteRow::am);
    }

    // "CM" tab — flat one-row-per-CM summary.
    public List<Map<String, Object>> getCmSummaries(LocalDate from, LocalDate to, String salesType, String status) {
        return getFlatPositionSummary(from, to, salesType, status, TeamSiteRow::cm);
    }

    // "SM" tab — flat one-row-per-SM summary (the "All Report" tree's own leaf level, flattened
    // directly instead of nested under RM/AM/CM).
    public List<Map<String, Object>> getSmSummaries(LocalDate from, LocalDate to, String salesType, String status) {
        return getFlatPositionSummary(from, to, salesType, status, TeamSiteRow::sm);
    }

    // ==================== Person Sitemaster Report ====================
    // "Person Details"' own site-level leaderboard — shown only once a name is clicked in "Team
    // Report" above (see TeamPerformancePage.js's openPersonDetails), scoped to just that RM/AM/CM/SM
    // person's own assigned sites (levelColumn+name, same real site_master column filter
    // TeamSiteRepository.loadSiteRows already uses for the person drill-down elsewhere — an RM sees
    // every site under their whole subtree, an SM sees just their own). Same shape/columns/
    // leaderboard convention as PrimarySalesReportsService#getSiteMasterPrimarySaleReport ("5.
    // Site_Master Primary_Sale Report" — Rank/Site_Code/Brand/Store_Name/City/State/Region/Target/
    // Sales/Achi/Vs LY, ranked by Sales descending, one final grand-total row), but unlike that page
    // (scoped to ONE sales type), this lists every one of the person's own active sites regardless of
    // Sales_Type — City/State/Region aren't in the shared TeamSiteRow/TeamSiteRepository (no other
    // section here needs them), so this uses its own private TeamSiteReportInfo/loadSiteReportInfo
    // instead of touching that shared shape. Each site's own real Sales_Type decides whether its
    // Sales/Target come from Primary_Sales(+Target, combo-matched via targetComboKey — see this
    // class's own header comment for why) or Secondary_Sales(+Target, genuinely per-(Site_Code,
    // Brand)) — same per-site branching aggregateSites already uses for "Team Report" above, just
    // applied per individual site row here instead of summed into a subtree.
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

    // `level` ("rm"/"am"/"cm"/"sm") is validated + mapped to its real site_master column via
    // TeamSiteRepository.requireLevelColumn (same whitelist every other person-scoped endpoint uses —
    // levelColumn is concatenated directly into SQL, so an unvalidated value would be a SQL injection
    // hole).
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

            // Primary's own Target is combo-matched (Brand, Channel, Partner), not per-site — dedup so
            // the grand total doesn't double-count a combo shared by several sites (same seenCombos
            // pattern getComboMatchedTargetSum/getSiteMasterPrimarySaleReport use). Secondary's own
            // Target is genuinely per-(Site_Code,Brand) already, no dedup needed.
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
