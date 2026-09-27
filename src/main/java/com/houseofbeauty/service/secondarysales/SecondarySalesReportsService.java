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

// Backs the Secondary Sales page's "3. Reports" section (All Report/Sub-Channel/Channel/Partner
// tabs), scoped to Site_Master rows whose own Sales_Type = 'Secondary Sales' (see loadSiteRows).
// Site_Master is the single source of truth for the Brand/Sub_Channel/Partner/Channel hierarchy, exact mirror of
// PrimarySalesReportsService's own use of it — but the Sales/Target joins here are simpler than
// that class's, because Secondary_Sales/Secondary_Sales_Target's own schemas don't carry the same
// data-quality problems Primary_Sales/Primary_Sales_Target do:
//   - Secondary_Sales has a DIRECT Site_Code column (no Ship_to indirection like Primary_Sales
//     needed) — siteSales joins on it directly.
//   - Secondary_Sales_Target has a REAL per-site unique key (UQ_SecondaryTarget on Site_Code,
//     Brand, Partner, Month — see database/01_schema.sql) — unlike Primary_Sales_Target, which a
//     prior investigation (see PrimarySalesReportsService's own header comment) found does NOT have
//     a clean per-site grain (every Site_Code there carries a full Partner×Channel×Brand
//     cross-product), forcing that class to drop Site_Code entirely and match Target by the bare
//     (Brand, Channel, Partner) string triple instead. Secondary_Sales_Target also has no Channel
//     column at all, so that combo-matching approach isn't even available here — but because this
//     table's grain genuinely is per-site by design, Target can instead be joined the exact same
//     way Sales is: by (Site_Code, Brand) — via targetBySite, keyed with this class's own siteKey.
//     A site absent from that map contributes nothing (addNullable keeps a parent's Mnt null rather
//     than a fabricated 0 when NONE of its children have a real Target row) — same "never fabricate
//     a number" principle PrimarySalesReportsService uses, just keyed by real site instead of an
//     inferred string combo. FIXED 2026-09-07: siteSales/targetBySite used to key by bare Site_Code
//     alone, which double-counted every site whose Site_Code is shared across two Site_Master Brand
//     rows (real, ~80 such codes) — a Partner/Total's rolled-up Sales/Mnt picked up that site's full
//     number once per brand branch it appears under instead of once total. Both now key by
//     (Site_Code, Brand) via siteKey, matching getSiteMasterSecondarySaleReport's own
//     secondarySalesByBrandSite/secondaryTargetByBrandSite, which never had this bug.
// No Projection dependency at all — Secondary_Sales_Projection is out of scope for this section (no
// Proj./Proj vs Tgt columns), so there's no TopProjectionService-equivalent call here.
@Service
public class SecondarySalesReportsService {

    private final JdbcTemplate jdbcTemplate;

    public SecondarySalesReportsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // One real Site_Master row's hierarchy path + its own Site_Code — a null/blank value at any
    // level falls into its own "Uncategorized" bucket rather than being silently dropped.
    private record SiteRow(String siteCode, String brand, String subChannel, String partner, String channel) {
    }

    // Scoped to site_master's own Sales_Type = 'Secondary Sales' (see
    // database/migrations/2026-09-04_add_site_master_sales_type.sql) — this class's "3. Reports"
    // section (All Report/Sub-Channel/Channel/Partner tabs, via getBrandHierarchy/getFlatSummary)
    // should only ever surface secondary-channel sites, same real classification used by
    // loadSecondarySaleSiteMasterInfo's own Sales_Type filter below.
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

    // Restricts siteRows to one real Site_Master Brand value (already converted to Site_Master's own
    // "ABH"/"Kylie" vocabulary via BrandFilter#target), null meaning every brand.
    private static List<SiteRow> filterByBrand(List<SiteRow> siteRows, String siteMasterBrand) {
        if (siteMasterBrand == null) {
            return siteRows;
        }
        return siteRows.stream().filter(site -> siteMasterBrand.equalsIgnoreCase(site.brand())).toList();
    }

    // Real (Site_Code, Brand)-keyed Sales for [from, to] — Secondary_Sales' own direct Site_Code/
    // Brand columns, no indirection needed. Keyed by siteKey (not bare Site_Code) so a Site_Code
    // shared by two Site_Master Brand rows doesn't get its Sales double-counted once per brand
    // branch — see this class's own header comment.
    private Map<String, BigDecimal> siteSales(LocalDate from, LocalDate to) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales) AS total FROM Secondary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // Real (Site_Code, Brand)-keyed Target for [fromMonth, toMonth] — Secondary_Sales_Target's own
    // real per-site grain (see this class's header comment), joined the same way siteSales is.
    private Map<String, BigDecimal> targetBySite(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // lastMonth*/lastYear* are the exact same [salesFrom, salesTo] window shifted back a calendar
    // month/year, so Vs LM/Vs LY always compare like-for-like day spans against the real current
    // window, not just "the whole previous month".
    private record Period(LocalDate salesFrom, LocalDate salesTo, YearMonth fromMonth, YearMonth toMonth,
                           LocalDate lastMonthFrom, LocalDate lastMonthTo, LocalDate lastYearFrom, LocalDate lastYearTo) {
    }

    // `from`/`to` default to the current calendar month-to-date when either is omitted.
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

    // "All Report" tab: real Brand -> Channel -> Sub_Channel -> Partner tree (Partner is the leaf).
    // MTD Sales/Vs LM/Vs LY are real and bottom-up accurate via the Site_Code join (siteSales).
    // Mnt (Target) is real too, via targetBySite — a Partner row's Mnt is the sum of its own sites'
    // real Target rows (addNullable — null if none of its sites have one, never a fabricated 0);
    // every level above rolls up the same way. No Proj./Proj vs Tgt columns (out of scope).
    public List<Map<String, Object>> getBrandHierarchy(LocalDate from, LocalDate to, String brandParam) {
        String normalizedBrand = BrandFilter.normalize(brandParam);
        String siteMasterBrand = BrandFilter.target(normalizedBrand);
        Period period = resolvePeriod(from, to);
        List<SiteRow> siteRows = filterByBrand(loadSiteRows(), siteMasterBrand);
        Map<String, BigDecimal> sales = siteSales(period.salesFrom(), period.salesTo());
        Map<String, BigDecimal> targetBySite = targetBySite(period.fromMonth(), period.toMonth());
        Map<String, BigDecimal> lastMonthSales = siteSales(period.lastMonthFrom(), period.lastMonthTo());
        Map<String, BigDecimal> lastYearSales = siteSales(period.lastYearFrom(), period.lastYearTo());

        // Brand -> Channel -> Sub_Channel -> Partner -> [siteKey(Site_Code, Brand)]. Keyed by the
        // (Site_Code, Brand) composite (not bare Site_Code) so the sales/targetBySite lookups below
        // never double-count a Site_Code shared across two Site_Master Brand rows.
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

    // Adds `addend` into `sum` treating null as "no real data yet" rather than 0 — null + null stays
    // null, null + a real value adopts that value, a real value + null is unchanged. Lets a parent's
    // rolled-up Mnt stay null when NONE of its children had a real Target row, instead of silently
    // reporting a fabricated "0".
    private static BigDecimal addNullable(BigDecimal sum, BigDecimal addend) {
        if (addend == null) {
            return sum;
        }
        return sum == null ? addend : sum.add(addend);
    }

    // "Channel" tab: every real Site_Master Channel, flattened via getFlatSummary.
    public List<Map<String, Object>> getChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, site -> normalizeChannelDisplay(site.channel()));
    }

    // "Brand" tab — per explicit request, a flat one-row-per-Brand summary alongside the "All
    // Report" tree's own Brand level (that tab's tree already breaks each Brand down further into
    // Channel/Sub_Channel/Partner; this one is just the flat top-line total per Brand, same shape
    // as every other flat tab here). When a single brand is already selected via the pill above,
    // this trivially reduces to that one Brand's own row plus Total — same as every other tab
    // already behaves under a brand filter.
    public List<Map<String, Object>> getBrandSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::brand);
    }

    // "Sub-Channel" tab — flat one-row-per-Sub_Channel summary, same convention as Channel/Brand/
    // Partner's own flat tabs.
    public List<Map<String, Object>> getSubChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::subChannel);
    }

    // "Partner" tab — flat one-row-per-Partner summary (the "All Report" tree's own leaf level,
    // flattened directly instead of nested under Brand/Channel/Sub_Channel).
    public List<Map<String, Object>> getPartnerSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::partner);
    }

    // Shared by every flat (single-level) Reports tab (Brand/Sub-Channel/Channel/Partner) — one row
    // per distinct value `dimensionKey` returns for a real Site_Master row, with real MTD Sales/
    // Vs LM/Vs LY ((Site_Code, Brand) join, same as getBrandHierarchy) and real Mnt (each site's own
    // targetBySite value, summed per dimension value via addNullable — no dedup needed, unlike
    // PrimarySalesReportsService, since each (Site_Code, Brand) is inherently unique here so its real
    // Target contributes exactly once no matter how it's grouped).
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

    // "offline"/"Offline" both occur in the wild — capitalizing the first letter keeps grouping
    // case-insensitive in effect while giving both a single, tidy display form.
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

    // One real site_master row's full identity for "Site_Master Secondary_Sale Report" — `channel`
    // added so getSiteMasterSecondarySaleReport can filter in-memory on the Filter Header's shared
    // Channel pill, same convention PrimarySalesReportsService's own PrimarySiteInfo already follows.
    // `operationalStatus` (kept raw, not orUncategorized'd — OperationalStatusFilter.matches does its
    // own null-safe classification) backs the Filter Header's shared Status pill, added when that
    // pill was wired into this section (replacing the old hardcoded Active-only SQL filter below).
    private record SecondarySaleSiteInfo(String siteCode, String brand, String storeName, String city,
                                          String state, String region, String channel, String operationalStatus) {
    }

    private static String siteKey(String siteCode, String brand) {
        return siteCode + "|" + brand;
    }

    // Every real site_master (Site_Code, Brand) row whose own Sales_Type is 'Secondary Sales' (see
    // database/migrations/2026-09-04_add_site_master_sales_type.sql) — site_master's own real
    // classification of which sites are secondary-channel sites, not an inferred "ever had a
    // Secondary_Sales row" proxy. A site tagged Secondary Sales still belongs on this report even if
    // it has zero Secondary_Sales rows in the currently viewed period (or ever). CHANGED: this used to
    // hardcode "AND UPPER(Operational_Status) = 'ACTIVE'" (Inactive/Upcoming excluded entirely, per
    // that earlier explicit request); now that the Filter Header's Status pill is wired into this
    // section too, Operational_Status is read raw and filtered in Java by
    // getSiteMasterSecondarySaleReport via OperationalStatusFilter.matches, same as every other
    // section on this page — "All" (this pill's own default) now correctly shows every status here.
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

    // Real (Site_Code, Brand)-keyed Secondary_Sales sum for [from, to] — same table/grain siteSales
    // above now also uses, kept as its own separate method here since this one's caller
    // (getSiteMasterSecondarySaleReport) has its own distinct site-info shape (SecondarySaleSiteInfo)
    // from getBrandHierarchy/getFlatSummary's SiteRow.
    private Map<String, BigDecimal> secondarySalesByBrandSite(LocalDate from, LocalDate to) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales) AS total FROM Secondary_Sales " +
                "WHERE Sales_Date BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, from, to)) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // Real (Site_Code, Brand)-keyed Secondary_Sales_Target sum for [fromMonth, toMonth].
    private Map<String, BigDecimal> secondaryTargetByBrandSite(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // "Site_Master Secondary_Sale Report" section: same shape/columns/leaderboard convention as
    // DashboardSiteReportService#getSiteReport (Rank/Site_Code/Brand/Store_Name/City/State/Region/
    // MNT/Actual Sales/Vs LY, ranked by Actual Sales descending, one final grand-total row) — but
    // scoped to ONLY site_master rows whose own Sales_Type = 'Secondary Sales' (see
    // loadSecondarySaleSiteMasterInfo), with MNT/Actual Sales sourced from Secondary_Sales/
    // Secondary_Sales_Target ONLY, no Primary_Sales/Primary_Sales_Target involved at all. Target is
    // safe to group directly by (Site_Code, Brand) — no Primary_Sales_Target-style combo-match needed
    // (see this class's own header comment on why Secondary_Sales_Target's grain is genuinely
    // per-site). brand/channel/status (all null = every row) wire in the Filter Header's shared Brand/
    // Channel/Status pills per explicit request, same real Site_Master values every other filterable
    // section on this page uses — filtered here in-memory (siteRows already carries every column),
    // no new SQL needed, same convention PrimarySalesReportsService's own in-memory Site_Master
    // filtering (getSiteJoinedSalesSum) already follows.
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
