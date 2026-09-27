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

// Site_Master is the single source of truth for the Brand/Sub_Channel/Partner/Channel hierarchy —
// neither Primary_Sales nor Primary_Sales_Target carries that hierarchy itself, so both are joined
// back to it instead of trusting their own copies of the same names:
//   - Primary_Sales has no Brand/Channel/Partner column of its own; its only link back to the
//     hierarchy is Ship_to = Site_Master.Site_Code. That join is exact by design, but VERIFIED
//     against live data (2026-08-24) to currently return zero matches: Primary_Sales' entire table
//     (584k rows) only ever uses 13 distinct Ship_to codes (410xxx range), none of which exist in
//     the current 114-row Site_Master (420xxx-423xxx range) — a live data gap, not a join bug. Until
//     that's resolved (fresh Primary_Sales upload matching the current stores, or vice versa), sums
//     via this join legitimately compute to 0.
//   - Primary_Sales_Target DOES carry its own Site_Code column (98,496 rows) alongside its own
//     Brand/Partner/Channel/Month/Sales_Target, but Site_Code is NOT a clean 1-site-1-target key —
//     LIVE-VERIFIED 2026-08-24 (twice): every Site_Code carries a full Partner×Channel×Brand
//     cross-product (36 rows/site/month), not one real per-site row, so Site_Code can't be used to
//     attribute Target at all (a live user report caught exactly this: a Site_Master partner
//     Primary_Sales_Target has NO row for was still showing a real-looking Mnt, inherited from other
//     partners' rows on the same Site_Code). Per explicit request, Mnt is instead matched on
//     Primary_Sales_Target's own three real columns — Brand, Channel, Partner — with NO Site_Code
//     involved (targetsByCombo).
// This class's own getSiteJoinedSalesSum/getComboMatchedTargetSum are reused by
// PrimarySalesTodayService#getMonthlySales so the Overview Insights card's MTD Sales/Month Target
// use these exact same real joins. CHANGED 2026-09-03 (five times): "4. Reports" was removed, REBUILT, removed again,
// rebuilt as an EXACT copy of SecondarySalesReportsService's own "3. Reports" (getBrandHierarchy tree
// + getBrandSummaries/getChannelSummaries/getSubChannelSummaries/getPartnerSummaries flat tabs, all
// routed through one shared getFlatSummary(dimensionKey) helper — see that class for the base
// architecture this still mirrors), then per explicit request had Proj./Proj vs Tgt columns added
// back on top (Secondary's own version has none — Secondary_Sales_Projection doesn't exist). Proj. is
// real, bottom-up from Primary_Sales_Projection via TopProjectionService, matched by the exact same
// Brand+Channel+Sub_Channel+Partner combo Primary_Sales_Projection itself is keyed by — ALWAYS the
// real current calendar month regardless of `from`/`to` (same filter-independent rule the Overview
// Insights card's own Projection figure follows). The other real difference from Secondary, forced by
// this class's own header comment above (not a design choice): Target is combo-matched
// (targetsByCombo/targetComboKey) instead of grouped by Site_Code. Sales is Bill_to-joined
// (primarySalesBySite) everywhere in this class now, including getSiteJoinedSalesSum (the Overview
// Insights card's own MTD Sales) — that method used to key off a separate Ship_to-only siteSales()
// map with no Brand in the key at all, which double-counted every real dual-brand site's combined
// sales once per Brand row in Site_Master the instant no Brand filter was applied (live-verified:
// UI showed ~50.5 Cr against a raw table SUM of ~28 Cr for the same window) — see
// getSiteJoinedSalesSum's own header comment for the full story. Ship_to and Bill_to are identical
// for every real Primary_Sales row (live-verified), so switching which of the two this method joins
// on changes nothing about which sale gets attributed to which site — only the double-count is fixed.
@Service
public class PrimarySalesReportsService {

    private final JdbcTemplate jdbcTemplate;
    private final TopProjectionService topProjectionService;

    public PrimarySalesReportsService(JdbcTemplate jdbcTemplate, TopProjectionService topProjectionService) {
        this.jdbcTemplate = jdbcTemplate;
        this.topProjectionService = topProjectionService;
    }

    // One real Site_Master row's hierarchy path + its own Site_Code — a null/blank value at any
    // level falls into its own "Uncategorized" bucket rather than being silently dropped.
    // operationalStatus is kept raw (not orUncategorized'd — OperationalStatusFilter.matches does its
    // own null-safe handling) purely for getSiteJoinedSalesSum/getComboMatchedTargetSum's own Status
    // filter, backing the Filter Header's shared Status pill.
    private record SiteRow(String siteCode, String brand, String subChannel, String partner, String channel,
                            String operationalStatus) {
    }

    // Scoped to site_master's own Sales_Type = 'Primary Sales' (see
    // database/migrations/2026-09-04_add_site_master_sales_type.sql) — this class's "Reports"
    // section (via getBrandHierarchy/getFlatSummary) and the Overview Insights card's own
    // getSiteJoinedSalesSum/getComboMatchedTargetSum (reused by PrimarySalesTodayService) should
    // only ever surface primary-channel sites, same real classification
    // SecondarySalesReportsService's own loadSiteRows already uses. FIXED 2026-09-07: this used to
    // pull every Site_Master row with no Sales_Type filter at all — verified against live data that
    // today's actual Sales/Target totals don't change (no Secondary-type site currently contributes
    // a Primary_Sales row, and no Secondary-only (Brand,Channel,Partner) combo independently carries
    // a real Primary_Sales_Target row), but the Reports tree/flat tabs were listing Secondary-type
    // Partners/Sub-Channels/Channels that don't belong on this page at all.
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

    // Restricts siteRows to one real Site_Master Brand value (already converted to Site_Master's own
    // "ABH"/"Kylie" vocabulary via BrandFilter#target), null meaning every brand — exact mirror of
    // SecondarySalesReportsService's own filterByBrand.
    private static List<SiteRow> filterByBrand(List<SiteRow> siteRows, String siteMasterBrand) {
        if (siteMasterBrand == null) {
            return siteRows;
        }
        return siteRows.stream().filter(site -> siteMasterBrand.equalsIgnoreCase(site.brand())).toList();
    }

    // Real Target per exact (Brand, Channel, Partner) combo for [fromMonth, toMonth] — Primary_Sales_
    // Target's own three real dimensions, summed with NO Site_Code involved at all. BUG FOUND AND
    // FIXED 2026-08-24, twice over: first grouping by Site_Code alone (summed BOTH brands' Target
    // into one number — Site_Code isn't unique in Primary_Sales_Target, every Site_Code carries a
    // full Partner×Channel×Brand cross-product, 36 rows/site/month, not one real per-site row), then
    // grouping by (Site_Code, Brand) — fixed the brand double-count but still summed every OTHER
    // partner's Target onto whichever single partner a site's row happened to represent (live user
    // report: "I don't have Partner Nykaa-Online in my target table, why does Mnt show a real-looking
    // number for it?"). Per explicit request, this drops Site_Code entirely and instead returns the
    // literal (Brand, Channel, Partner) total the table actually has — the ONE grain that's both real
    // in Primary_Sales_Target (a genuine column triple, not inferred) and matchable against
    // Site_Master's own Brand/Channel/Partner columns. A combo absent here (e.g. any "Nykaa-Online"-style online partner — Primary_Sales_Target
    // carries none, live-verified) has no entry in the returned map at all — callers use Map#get, not
    // getOrDefault(...,ZERO), so an absent combo shows "—" rather than a fabricated zero.
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

    // Real Site_Code-joined Sales sum for [from, to], optionally restricted to one real Site_Master
    // Brand value (full name, e.g. "Anastasia Beverly hills" — see BrandFilter#product; null = both),
    // one real Channel value (null = every channel), and/or a Status classification (see
    // OperationalStatusFilter, null = every status) — reused by PrimarySalesTodayService#
    // getMonthlySales so the Overview Insights card's MTD Sales goes through this same real join
    // instead of Primary_Sales' own Article_Code -> Product_Master brand join (which uses a different
    // Brand vocabulary and a different table's copy of Sales entirely).
    //
    // FIXED — real bug, live-verified: this used to key off primarySalesBySite's own predecessor
    // (a Ship_to-ONLY siteSales() map, no Brand), then look it up by site.siteCode() alone. Since
    // Site_Master's real key is (Site_Code, Brand) — not Site_Code alone — a site that sells BOTH real
    // Brands has TWO SiteRow entries for the same siteCode, and with no brand filter applied (brand ==
    // null, "All") the loop above doesn't skip either one — so that site's already-combined
    // (both-brands) sales total got added ONCE PER BRAND ROW, roughly doubling the real total for any
    // dual-brand site (confirmed live: UI showed ~50.5 Cr against a raw `SUM(Sales) FROM Primary_Sales
    // WHERE Sales_Date >= '2026-04-01'` of ~28 Cr). A single-brand filter had the opposite, quieter bug
    // — no double-count, but it was still adding the SITE's combined-both-brands total, not that
    // brand's own real portion of it. Switched to primarySalesBySite (already real Bill_to+Brand-keyed,
    // the same map "4. Reports" already uses correctly) + siteKey so each SiteRow only ever pulls its
    // own Brand's own real sales at that Site_Code — the double-count is gone AND a specific-brand
    // filter now returns that brand's genuine portion instead of the whole site's total.
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

    // Real (Brand, Channel, Partner)-combo-matched Target sum for [fromMonth, toMonth], optionally
    // restricted to one real Site_Master Brand value (full name; null = both), one real Channel value
    // (null = every channel), and/or a Status classification (null = every status), each distinct real
    // combo counted once (seenCombos dedup — Site_Master can list the same combo across several
    // physical Site_Codes, but Primary_Sales_Target's own total for that combo isn't per-Site_Code).
    // Reused by PrimarySalesTodayService#getMonthlySales so the Overview Insights card's Month Target
    // doesn't fabricate a number for a combo Site_Master doesn't recognize, unlike
    // PrimarySalesTargetService#getTargetSumInRange's whole-table-for-the-brand sum (e.g. every online
    // Partner today).
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

    // lastMonth*/lastYear* are the exact same [salesFrom, salesTo] window shifted back a calendar
    // month/year (minusMonths(1)/minusYears(1) on both ends — same convention
    // PrimarySalesProductLevelService uses for its own Vs LM/Vs LY), so Vs LM/Vs LY always compare
    // like-for-like day spans against the real current window, not just "the whole previous month".
    private record Period(LocalDate salesFrom, LocalDate salesTo, YearMonth fromMonth, YearMonth toMonth,
                           LocalDate lastMonthFrom, LocalDate lastMonthTo, LocalDate lastYearFrom, LocalDate lastYearTo) {
    }

    // `from`/`to` default to the current calendar month-to-date when either is omitted, same
    // convention used across the rest of this page's date-scoped endpoints.
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

    // Adds `addend` into `sum` treating null as "no real data yet" rather than 0 — null + null stays
    // null, null + a real value adopts that value, a real value + null is unchanged. This is what
    // lets a parent's rolled-up Mnt stay null when NONE of its children had a real Target match,
    // instead of silently reporting a fabricated "0".
    private static BigDecimal addNullable(BigDecimal sum, BigDecimal addend) {
        if (addend == null) {
            return sum;
        }
        return sum == null ? addend : sum.add(addend);
    }

    // "offline"/"Offline" both occur in the wild (verified against live Site_Master) — capitalizing
    // the first letter keeps grouping case-insensitive in effect while giving both a single, tidy
    // display form.
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

    // ==================== "4. Reports" section ====================
    // Base architecture is an exact mirror of SecondarySalesReportsService's own "3. Reports" — ALL
    // real site_master rows for the current brand filter form the universe (a site with none just
    // shows zero/null, same as Secondary's own Reports). Every Sales/Target
    // figure sourced ONLY from site_master/Primary_Sales (Bill_to-joined, via primarySalesBySite,
    // defined below)/Primary_Sales_Target (combo-matched, via targetsByCombo) — never Secondary_Sales/
    // Secondary_Sales_Target. Proj./Proj vs Tgt columns are the one real addition on top of Secondary's
    // own version (which has none — Secondary_Sales_Projection doesn't exist): real, bottom-up from
    // Primary_Sales_Projection via TopProjectionService, matched by the exact same Brand+Channel+
    // Sub_Channel+Partner combo Primary_Sales_Projection itself is keyed by — ALWAYS the real current
    // calendar month regardless of `from`/`to` (same filter-independent rule the Overview Insights
    // card's own Projection figure follows).

    // "All Report" tab: real Brand -> Channel -> Sub_Channel -> Partner tree (Partner is the leaf).
    // MTD Sales/Vs LM/Vs LY are real via primarySalesBySite (Bill_to-joined, same map
    // getSiteJoinedSalesSum's own Overview MTD Sales now shares — see this class's own header comment
    // for the full story). Mnt
    // is real too, but ONLY from a real, exact (Brand, Channel, Partner) match in Primary_Sales_Target
    // (targetsByCombo) — a Partner row's Mnt is that exact combo's real Sales_Target if one exists,
    // else null (no fabricated split); every level above rolls up bottom-up from only its children
    // that themselves matched, staying null instead of a fake 0 if none did (addNullable). Proj. rolls
    // up bottom-up too, but via plain addition (defaults to zero, never null — a combo simply hasn't
    // submitted a Projection this month). `brandParam` ("all"/"abh"/"kylie") wires the Overview
    // section's shared Brand pill in, same convention every other brand-filterable endpoint on this
    // page follows — Reports itself has no Brand-filter pill of its own (always "all" from the
    // frontend, same as Secondary's version).
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

        // Brand -> Channel -> Sub_Channel -> Partner -> [siteKey]. Grouped by Channel's normalized
        // display form straight off Site_Master, same as every other level.
        Map<String, Map<String, Map<String, Map<String, List<String>>>>> tree = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (SiteRow site : siteRows) {
            tree.computeIfAbsent(site.brand(), b -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(normalizeChannelDisplay(site.channel()), c -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.subChannel(), s -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER))
                    .computeIfAbsent(site.partner(), p -> new ArrayList<>())
                    .add(siteKey(site.siteCode(), site.brand()));
        }

        // FIXED 2026-09-07: real bug — targetComboKey is (Brand, Channel, Partner) only, no
        // Sub_Channel, but this tree's own leaf level is Partner-under-Sub_Channel. A real Partner
        // that spans multiple real Sub_Channels for the same Brand+Channel (confirmed live: "Corporate
        // Order" does, under both Brands, 4 distinct Sub_Channels each) got its own combo's FULL
        // target re-added into channelTarget/brandTarget/grandTarget once per Sub_Channel it
        // appeared under, inflating the Reports section's own MNT total (5 Cr) past Overview's own
        // correctly-deduped total (4.3 Cr — both use the same seenCombos-dedup pattern via
        // getComboMatchedTargetSum). Each Partner node still DISPLAYS its own real, undiminished
        // target on every occurrence — only the roll-up into its parent Sub_Channel/Channel/Brand/
        // Grand-Total is gated to the combo's first-seen occurrence, so it's never summed twice.
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
                        // Only the combo's first-seen occurrence anywhere in the tree rolls up into its
                        // parent — see this method's own seenCombos comment above for why (a Partner
                        // can span multiple real Sub_Channels, but its own Primary_Sales_Target combo
                        // doesn't split by Sub_Channel, so re-adding it per Sub_Channel would inflate
                        // every level above). The node above still always shows the real full value.
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

    // "Brand" tab — flat one-row-per-Brand summary. Per Secondary's own convention this is NOT wired
    // into the frontend's tab toggle (Brand-level rows are already visible via the "All Report"
    // hierarchy tree's own top level) — kept as a ready-made building block for parity with
    // SecondarySalesReportsService's own getBrandSummaries, exactly as unused there too. No per-Brand
    // Projection breakdown exists (TopProjectionService has no getLatestProjectionsByBrandInRange), so
    // Proj. is always zero here — harmless since this tab is never rendered.
    public List<Map<String, Object>> getBrandSummaries(LocalDate from, LocalDate to, String brandParam) {
        return getFlatSummary(from, to, brandParam, SiteRow::brand, Map.of());
    }

    // "Channel" tab — flat one-row-per-Channel summary. Proj. via TopProjectionService#
    // getLatestProjectionsByChannelInRange, called with from == to == the real current calendar
    // month regardless of this method's own `from`/`to` (same filter-independent rule
    // getBrandHierarchy's own Proj. follows).
    public List<Map<String, Object>> getChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        String siteMasterBrand = BrandFilter.target(BrandFilter.normalize(brandParam));
        YearMonth currentMonth = YearMonth.now();
        Map<String, BigDecimal> projByChannel =
                topProjectionService.getLatestProjectionsByChannelInRange(currentMonth, currentMonth, siteMasterBrand);
        return getFlatSummary(from, to, brandParam, site -> normalizeChannelDisplay(site.channel()), projByChannel);
    }

    // "Sub-Channel" tab — flat one-row-per-Sub_Channel summary. Proj. via TopProjectionService#
    // getLatestProjectionsBySubChannelInRange, same filter-independent current-month rule.
    public List<Map<String, Object>> getSubChannelSummaries(LocalDate from, LocalDate to, String brandParam) {
        String siteMasterBrand = BrandFilter.target(BrandFilter.normalize(brandParam));
        YearMonth currentMonth = YearMonth.now();
        Map<String, BigDecimal> projBySubChannel =
                topProjectionService.getLatestProjectionsBySubChannelInRange(currentMonth, currentMonth, siteMasterBrand);
        return getFlatSummary(from, to, brandParam, SiteRow::subChannel, projBySubChannel);
    }

    // "Partner" tab — flat one-row-per-Partner summary (the "All Report" tree's own leaf level,
    // flattened directly instead of nested under Brand/Channel/Sub_Channel). Proj. via
    // TopProjectionService#getLatestProjectionsByPartnerInRange, same filter-independent current-month
    // rule.
    public List<Map<String, Object>> getPartnerSummaries(LocalDate from, LocalDate to, String brandParam) {
        String siteMasterBrand = BrandFilter.target(BrandFilter.normalize(brandParam));
        YearMonth currentMonth = YearMonth.now();
        Map<String, BigDecimal> projByPartner =
                topProjectionService.getLatestProjectionsByPartnerInRange(currentMonth, currentMonth, siteMasterBrand, null);
        return getFlatSummary(from, to, brandParam, SiteRow::partner, projByPartner);
    }

    // Shared by every flat (single-level) Reports tab (Brand/Sub-Channel/Channel/Partner) — one row
    // per distinct value `dimensionKey` returns for a real Site_Master row, with real MTD Sales/
    // Vs LM/Vs LY (primarySalesBySite, same Bill_to join as getBrandHierarchy), real Mnt
    // (targetsByCombo, deduped per distinct combo — Site_Master can list the same combo across
    // several physical sites, but Primary_Sales_Target's own total for that combo isn't per-site, so
    // it must not be added in more than once), and real Proj. (`projByDimension`, pre-computed by the
    // caller via whichever TopProjectionService getLatestProjectionsBy*InRange matches this dimension
    // — see getChannelSummaries/getSubChannelSummaries/getPartnerSummaries above).
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

    // Real (Bill_to, Brand)-keyed Primary_Sales sum for [from, to].
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
