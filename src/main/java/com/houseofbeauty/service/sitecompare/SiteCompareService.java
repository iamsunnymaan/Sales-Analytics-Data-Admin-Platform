package com.houseofbeauty.service.sitecompare;

import com.houseofbeauty.dto.sitecompare.SitePairDto;
import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

// Backs the Site Status page's own "Compare" modal (SiteStatusPage.html/.js) — its three tabs (States,
// Sites in a State, Selected Stores) all reduce to the same all-time Sales-vs-Target metrics
// DashboardSiteReportService already computes per (Site_Code, Brand) row for the Dashboard's own
// Site_Master Full Report, just without that report's own date-range filtering (this page's KPI cards
// are all-time totals, same convention SiteDetailService's own "Total" card uses — no period picker
// here to keep the modal simple) and grouped differently per tab.
//
// Primary Sales attributes via (Bill_to, Brand) same composite FK site_master's own
// FK_PrimarySales_Billto_SiteMaster uses; Secondary Sales/Target attribute directly by (Site_Code,
// Brand). Primary_Sales_Target has no real per-site grain — its real key is (Brand, Channel, Partner,
// Month) — so it's combo-matched per site same as everywhere else in this codebase that touches that
// table (see DashboardSiteReportService's own header comment for the full explanation). compareStates
// dedupes that combo PER STATE so two sites in the same state sharing a Partner don't double-count
// their shared target — but a Partner whose sites span multiple states legitimately has that combo's
// whole target counted once in each of those states, since the table has no per-state grain to split
// it by; this is the same approximation the rest of this codebase already accepts for this table.
@Service
public class SiteCompareService {

    private final JdbcTemplate jdbcTemplate;

    public SiteCompareService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private record SiteInfo(String siteCode, String brand, String storeName, String city, String state,
                             String channel, String partner) {
    }

    private record Metrics(BigDecimal sales, BigDecimal target, BigDecimal achievementPct) {
    }

    private static String orDash(String value) {
        return (value == null || value.isBlank()) ? "—" : value;
    }

    private static String siteKey(String siteCode, String brand) {
        return siteCode + "|" + brand;
    }

    private static String normalizeComboKey(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String targetComboKey(String brand, String channel, String partner) {
        return normalizeComboKey(brand) + "|" + normalizeComboKey(channel) + "|" + normalizeComboKey(partner);
    }

    // status ("all"/"active"/"inactive"/"upcoming", the Site Insight page's own Status toggle pill —
    // see OperationalStatusFilter) scopes every Compare tab the same way it scopes the Site Code
    // picker/Geo Map, so a comparison never includes a site the rest of the page's current filter has
    // hidden.
    private List<SiteInfo> loadAllSites(String status) {
        List<SiteInfo> rows = new ArrayList<>();
        String sql = "SELECT Site_Code, Brand, Store_Name, City, State, Channel, Partner FROM site_master " +
                "WHERE 1=1" + OperationalStatusFilter.whereClause(status) + " ORDER BY Site_Code, Brand";
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            rows.add(new SiteInfo(
                    (String) row.get("Site_Code"),
                    (String) row.get("Brand"),
                    orDash((String) row.get("Store_Name")),
                    orDash((String) row.get("City")),
                    orDash((String) row.get("State")),
                    (String) row.get("Channel"),
                    (String) row.get("Partner")));
        }
        return rows;
    }

    // Real (Bill_to, Brand)-keyed Primary_Sales all-time sum — same grouping
    // DashboardSiteReportService#primarySalesBySite uses, just with no date filter.
    private Map<String, BigDecimal> primarySalesAllTime() {
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(
                "SELECT Bill_to, Brand, SUM(Sales) AS total FROM Primary_Sales GROUP BY Bill_to, Brand")) {
            result.put(siteKey((String) row.get("Bill_to"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> secondarySalesAllTime() {
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(
                "SELECT Site_Code, Brand, SUM(Sales) AS total FROM Secondary_Sales GROUP BY Site_Code, Brand")) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> secondaryTargetAllTime() {
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(
                "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target GROUP BY Site_Code, Brand")) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    private Map<String, BigDecimal> primaryTargetComboAllTime() {
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(
                "SELECT Brand, Channel, Partner, SUM(Sales_Target) AS total FROM Primary_Sales_Target " +
                        "GROUP BY Brand, Channel, Partner")) {
            result.put(targetComboKey((String) row.get("Brand"), (String) row.get("Channel"), (String) row.get("Partner")),
                    asDecimal(row.get("total")));
        }
        return result;
    }

    private record AllTimeData(Map<String, BigDecimal> primarySales, Map<String, BigDecimal> secondarySales,
                                Map<String, BigDecimal> secondaryTarget, Map<String, BigDecimal> primaryTargetCombo) {
    }

    private AllTimeData loadAllTimeData() {
        return new AllTimeData(primarySalesAllTime(), secondarySalesAllTime(), secondaryTargetAllTime(),
                primaryTargetComboAllTime());
    }

    private Metrics metricsForSite(SiteInfo site, AllTimeData data) {
        String key = siteKey(site.siteCode(), site.brand());
        BigDecimal sales = data.primarySales().getOrDefault(key, BigDecimal.ZERO)
                .add(data.secondarySales().getOrDefault(key, BigDecimal.ZERO));
        BigDecimal secondaryPortion = data.secondaryTarget().get(key);
        BigDecimal primaryPortion = data.primaryTargetCombo().get(targetComboKey(site.brand(), site.channel(), site.partner()));
        BigDecimal target = addNullable(primaryPortion, secondaryPortion);
        return new Metrics(sales, target, achievementPct(sales, target));
    }

    private static BigDecimal achievementPct(BigDecimal sales, BigDecimal target) {
        return (target != null && target.compareTo(BigDecimal.ZERO) > 0)
                ? sales.multiply(BigDecimal.valueOf(100)).divide(target, 1, RoundingMode.HALF_UP)
                : null;
    }

    // One row per real State — siteCount, combined all-time Sales, and the Primary-Target-combo-dedup
    // (per state, see class header) all-time Target/Achievement %. Sorted by Sales descending.
    public List<Map<String, Object>> compareStates(String status) {
        List<SiteInfo> sites = loadAllSites(status);
        AllTimeData data = loadAllTimeData();

        Map<String, List<SiteInfo>> byState = new LinkedHashMap<>();
        for (SiteInfo site : sites) {
            byState.computeIfAbsent(site.state(), k -> new ArrayList<>()).add(site);
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map.Entry<String, List<SiteInfo>> entry : byState.entrySet()) {
            BigDecimal sales = BigDecimal.ZERO;
            BigDecimal target = null;
            Set<String> seenCombos = new HashSet<>();
            for (SiteInfo site : entry.getValue()) {
                String key = siteKey(site.siteCode(), site.brand());
                sales = sales.add(data.primarySales().getOrDefault(key, BigDecimal.ZERO))
                        .add(data.secondarySales().getOrDefault(key, BigDecimal.ZERO));
                target = addNullable(target, data.secondaryTarget().get(key));
                String comboKey = targetComboKey(site.brand(), site.channel(), site.partner());
                if (seenCombos.add(comboKey)) {
                    target = addNullable(target, data.primaryTargetCombo().get(comboKey));
                }
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("state", entry.getKey());
            row.put("siteCount", entry.getValue().size());
            row.put("totalSales", sales.setScale(2, RoundingMode.HALF_UP));
            row.put("totalTarget", target == null ? null : target.setScale(2, RoundingMode.HALF_UP));
            row.put("achievementPct", achievementPct(sales, target));
            rows.add(row);
        }
        rows.sort(Comparator.comparing(r -> (BigDecimal) r.get("totalSales"), Comparator.reverseOrder()));
        return rows;
    }

    public List<String> getDistinctStates() {
        return jdbcTemplate.queryForList(
                "SELECT DISTINCT State FROM site_master WHERE State IS NOT NULL AND LTRIM(RTRIM(State)) <> '' " +
                        "ORDER BY State",
                String.class);
    }

    // Every real site_master row (Site_Code, Brand, Store_Name, City, State) — feeds the Compare
    // modal's own "Selected Stores" tab searchable picker, same one-shot-fetch-then-filter-client-side
    // convention GeoMap.js's own bundled data uses. Scoped by the same Status toggle as every other
    // Compare tab (see loadAllSites above) — the picker list itself only ever offers sites the rest
    // of the page's current filter would show.
    public List<Map<String, Object>> getAllStoresForPicker(String status) {
        String sql = "SELECT Site_Code, Brand, Store_Name, City, State FROM site_master WHERE 1=1" +
                OperationalStatusFilter.whereClause(status) + " ORDER BY Store_Name, Brand";
        return new ArrayList<>(jdbcTemplate.queryForList(sql));
    }

    public List<Map<String, Object>> compareSitesInState(String state, String status) {
        List<SiteInfo> sites = loadAllSites(status).stream().filter(s -> s.state().equals(state)).toList();
        return compareSites(sites);
    }

    // No status param here, unlike every other tab above — these are exact (Site_Code, Brand) picks
    // the user already made from the Status-filtered picker list (getAllStoresForPicker), so
    // re-applying the toggle here would only risk silently dropping a pick if the toggle changed
    // between picking and comparing.
    public List<Map<String, Object>> compareSelectedStores(List<SitePairDto> pairs) {
        Set<String> wanted = new HashSet<>();
        for (SitePairDto p : pairs) {
            wanted.add(siteKey(p.siteCode(), p.brand()));
        }
        List<SiteInfo> sites = loadAllSites(null).stream().filter(s -> wanted.contains(siteKey(s.siteCode(), s.brand()))).toList();
        return compareSites(sites);
    }

    // Shared by the "Sites in a State" and "Selected Stores" tabs — one row per (Site_Code, Brand),
    // sorted by Sales descending, plus a trailing Total row (rank/siteCode null) whose own Target
    // dedupes shared Primary combos across just these rows, same seenCombos convention
    // DashboardSiteReportService's own grand-total row uses.
    private List<Map<String, Object>> compareSites(List<SiteInfo> sites) {
        AllTimeData data = loadAllTimeData();

        record RowData(SiteInfo info, Metrics metrics) {
        }
        List<RowData> rows = sites.stream()
                .map(s -> new RowData(s, metricsForSite(s, data)))
                .sorted(Comparator.comparing((RowData r) -> r.metrics().sales()).reversed())
                .toList();

        List<Map<String, Object>> result = new ArrayList<>();
        BigDecimal grandSales = BigDecimal.ZERO;
        BigDecimal grandTarget = null;
        Set<String> seenCombos = new HashSet<>();
        for (RowData row : rows) {
            SiteInfo site = row.info();
            Metrics metrics = row.metrics();
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("siteCode", site.siteCode());
            node.put("brand", site.brand());
            node.put("storeName", site.storeName());
            node.put("city", site.city());
            node.put("state", site.state());
            node.put("totalSales", metrics.sales().setScale(2, RoundingMode.HALF_UP));
            node.put("totalTarget", metrics.target() == null ? null : metrics.target().setScale(2, RoundingMode.HALF_UP));
            node.put("achievementPct", metrics.achievementPct());
            result.add(node);

            grandSales = grandSales.add(metrics.sales());
            String comboKey = targetComboKey(site.brand(), site.channel(), site.partner());
            BigDecimal secondaryPortion = data.secondaryTarget().get(siteKey(site.siteCode(), site.brand()));
            grandTarget = addNullable(grandTarget, secondaryPortion);
            if (seenCombos.add(comboKey)) {
                grandTarget = addNullable(grandTarget, data.primaryTargetCombo().get(comboKey));
            }
        }

        if (!rows.isEmpty()) {
            Map<String, Object> totalNode = new LinkedHashMap<>();
            totalNode.put("siteCode", null);
            totalNode.put("brand", null);
            totalNode.put("storeName", "Total");
            totalNode.put("city", null);
            totalNode.put("state", null);
            totalNode.put("totalCount", rows.size());
            totalNode.put("totalSales", grandSales.setScale(2, RoundingMode.HALF_UP));
            totalNode.put("totalTarget", grandTarget == null ? null : grandTarget.setScale(2, RoundingMode.HALF_UP));
            totalNode.put("achievementPct", achievementPct(grandSales, grandTarget));
            result.add(totalNode);
        }
        return result;
    }

    private static BigDecimal addNullable(BigDecimal a, BigDecimal b) {
        if (a == null) return b;
        if (b == null) return a;
        return a.add(b);
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal bd) return bd;
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }
}
