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

// Backs the Secondary Sales page's "1. Overview" cross-tab (real Brand columns x real Channel
// sub-columns) — GET /api/secondary-sales/overview. Every brand/channel shown is real, live
// Site_Master data (see getAvailableBrands/getAvailableChannels), not the hardcoded ABH/Kylie x
// Offline/Online this section started as a frontend mock with. Scoped to Site_Master rows whose own
// Sales_Type = 'Secondary Sales' (see loadSiteRows/getAvailableBrands/getAvailableChannels) — same
// real classification SecondarySalesReportsService's own loadSiteRows already established for
// "3. Reports". Same (Site_Code, Brand)-keyed join
// conventions SecondarySalesReportsService already established (Secondary_Sales has a direct
// Site_Code column, Secondary_Sales_Target has a real per-site unique key — see that class's own
// header comment for why this is simpler than PrimarySalesReportsService's combo-matching
// workaround), plus an explicit INNER JOIN to Product_Master on Article_Code for Actual Sales/Vs LY
// (per explicit request) — that join only gates which Secondary_Sales rows count (a row whose
// Article_Code Product_Master doesn't recognize doesn't contribute), it never reads Product_Master's
// own Brand column: brand/channel attribution here is entirely Site_Master-driven (via Site_Code),
// same as every other section on this page, so Product_Master's OWN Brand vocabulary (full display
// names, see BrandFilter's own header comment) never needs to enter the picture. No Batch_Master
// join — Secondary_Sales carries no Batch_Code column at all (unlike Primary_Sales), so there is
// nothing to join a Batch_Master row on.
@Service
public class SecondarySalesOverviewService {

    private final JdbcTemplate jdbcTemplate;

    public SecondarySalesOverviewService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // One real Site_Master row's Brand/Channel/Operational_Status + its own Site_Code — own copy
    // rather than a shared import, same "each service owns its copy" convention
    // SecondarySalesReportsService/SecondarySalesDailyTrendService already follow on this page.
    // operationalStatus backs the Filter Header's shared Status pill (see getOverview).
    private record SiteRow(String siteCode, String brand, String channel, String operationalStatus) {
    }

    // (Site_Code, Brand) composite key — own copy of SecondarySalesReportsService's own siteKey,
    // same "each service owns its copy" convention this file's own header comment already notes.
    private static String siteKey(String siteCode, String brand) {
        return siteCode + "|" + brand;
    }

    // Scoped to site_master's own Sales_Type = 'Secondary Sales' (see
    // database/migrations/2026-09-04_add_site_master_sales_type.sql) — FIXED 2026-09-07: this used to
    // pull every Site_Master row with no Sales_Type filter at all, unlike SecondarySalesReportsService
    // (loadSiteRows)/getSiteMasterSecondarySaleReport (loadSecondarySaleSiteMasterInfo), which both
    // already scoped to this same classification. Didn't change any totals in practice (Secondary_Sales
    // rows only ever match secondary-type sites), but "1. Overview" should only ever surface
    // secondary-channel sites, same as "3. Reports"/"4. Site_Master Secondary_Sale Report".
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

    // Real distinct Brand values Site_Master currently has among Secondary Sales-typed sites — same
    // query/convention as SecondarySalesDailyTrendService.getAvailableBrands (this page's Daily
    // Trends brand pill), minus that method's own Sales_Type filter since only this class's own
    // getOverview calls this one, and it's scoped to secondary-channel sites like every other section.
    public List<String> getAvailableBrands() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master " +
                "WHERE Sales_Type = 'Secondary Sales' AND Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> ''";
        TreeSet<String> brands = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String brand : jdbcTemplate.queryForList(sql, String.class)) {
            brands.add(brand.trim());
        }
        return new ArrayList<>(brands);
    }

    // Real distinct Channel values Site_Master currently has among Secondary Sales-typed sites,
    // display-normalized — same convention SecondarySalesReportsService's own
    // normalizeChannelDisplay/getFlatSummary(channel) already use.
    public List<String> getAvailableChannels() {
        String sql = "SELECT DISTINCT Channel FROM Site_Master " +
                "WHERE Sales_Type = 'Secondary Sales' AND Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> ''";
        TreeSet<String> channels = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String channel : jdbcTemplate.queryForList(sql, String.class)) {
            channels.add(normalizeChannelDisplay(channel));
        }
        return new ArrayList<>(channels);
    }

    // Real (Site_Code, Brand)-keyed Actual Sales for [from, to] — Secondary_Sales' own direct
    // Site_Code/Brand columns (no indirection needed, same as SecondarySalesReportsService's own
    // siteSales), INNER JOINed to Product_Master on Article_Code per explicit request (see this
    // class's header comment on why that join never reads Product_Master's own Brand column). Keyed
    // by siteKey (not bare Site_Code) — FIXED 2026-09-07: a bare-Site_Code key double-counted every
    // site whose Site_Code is shared across two Site_Master Brand rows (real, ~80 such codes), same
    // bug SecondarySalesReportsService's own siteSales/targetBySite had (see that class's header
    // comment) — both now key by (Site_Code, Brand) so this section's totals agree with "4.
    // Site_Master Secondary_Sale Report"'s own (Site_Code, Brand)-keyed totals.
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

    // Real (Site_Code, Brand)-keyed Target for [fromMonth, toMonth] — identical fix/grain as
    // SecondarySalesReportsService's own targetBySite (see this class's own siteSales comment above).
    private Map<String, BigDecimal> targetBySite(YearMonth fromMonth, YearMonth toMonth) {
        String sql = "SELECT Site_Code, Brand, SUM(Sales_Target) AS total FROM Secondary_Sales_Target " +
                "WHERE Month BETWEEN ? AND ? GROUP BY Site_Code, Brand";
        Map<String, BigDecimal> result = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, fromMonth.atDay(1), toMonth.atDay(1))) {
            result.put(siteKey((String) row.get("Site_Code"), (String) row.get("Brand")), asDecimal(row.get("total")));
        }
        return result;
    }

    // Unlike SecondarySalesReportsService's own resolvePeriod (which clamps to an MTD-style "today"
    // cutoff for its own Sales window), this section's Actual Sales/Vs LY need the EXACT selected
    // [from, to] range, day-precise, not rounded — a future-dated `to` is used exactly as given (it
    // will simply sum to real data that doesn't exist yet, same as every other real-time section on
    // this app tolerates for an in-progress/future period). fromMonth/toMonth still feed Month
    // Target's whole-month query; lastYearFrom/lastYearTo are the exact same span shifted back a
    // calendar year.
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

    // Adds `addend` into `sum` treating null as "no real data yet" rather than 0 — same null-safe
    // rollup SecondarySalesReportsService's own addNullable already establishes on this page.
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

    // Null-safe growth %, same rule GrowthMath.growthPct implements elsewhere on this app (null when
    // previous is 0 and current isn't; 0 when both are 0) — a private copy here since this class
    // needs it for Vs LY only and pulling in the shared GrowthMath for one call isn't worth the
    // cross-package dependency (this page's own services already duplicate small helpers like this
    // rather than share them — see e.g. every service on this page having its own asDecimal/
    // normalizeChannelDisplay).
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

    // One brand-or-"Total" group's own real-channel figures plus its synthesized "Total" channel —
    // shared by both the per-real-brand loop and the grand "Total" brand group below (same
    // computation, just given a different subset of site codes to work over).
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
        // First pass: every real channel's own Target/Actual/Vs LY (SOB filled in afterward, once
        // this group's own Total Actual — the SOB denominator — is known).
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

        // Second pass: SOB — each real channel's share of THIS group's own Total Actual Sales.
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
        // The group's own "Total" channel cell — its SOB is always 100% of itself once it has any
        // real sales (matches the original worked example: ABH's own Total row read 100%), null only
        // when the whole group has no real sales at all.
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

    // Status pill options — backs the Filter Header's Status pill (GET /api/secondary-sales/statuses),
    // same fixed app-wide Site Status vocabulary OperationalStatusFilter classifies against (not
    // derived from Site_Master's own live distinct Operational_Status text — that column is free
    // text with no canonical enumeration, see OperationalStatusFilter's own header comment), mirroring
    // PrimarySalesTodayService.getAvailableStatuses's own comment. The COUNT(*) is a real Site_Master
    // round-trip so a genuine DB-connectivity problem (query throws) OR an empty/not-yet-imported
    // Site_Master for this Sales_Type (count 0) both surface as an empty list here, same "Not
    // Available" fallback Brand/Channel's own fetch failure already shows.
    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM Site_Master WHERE Sales_Type = 'Secondary Sales'", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    // brand/channel/status wire in the Filter Header's shared Brand/Channel/Status pills, per explicit
    // request — "all" (any/all of them) leaves the full cross-tab untouched; a specific brand/channel
    // narrows the `brands`/`channels` lists below to just that one real value (plus its own
    // synthesized "Total"), before any of the group-building loops run. status narrows which
    // Site_Master rows feed the Brand->Channel->[siteKey] map below (see
    // OperationalStatusFilter.matches), same in-memory filtering convention
    // PrimarySalesReportsService's own getSiteJoinedSalesSum uses. brandFilter is matched against
    // Site_Master.Brand in its own real vocabulary (BrandFilter#product — confirmed live, same
    // full-name values getAvailableBrands() itself returns, NOT BrandFilter#target's short-code form
    // Primary's own Site_Master rows use), channelFilter matched case-insensitively.
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

        // Brand -> Channel -> [siteKey(Site_Code, Brand)] — a site row with no real (non-blank) Brand
        // or Channel is skipped entirely (this table only ever shows real values; "Not Available" is
        // the fallback for "nothing real exists", not an "Uncategorized" bucket the way the Reports
        // tree has one). Keyed by the (Site_Code, Brand) composite (not bare Site_Code) so the
        // sales/targetBySite lookups in buildChannelGroup never double-count a Site_Code shared
        // across two Site_Master Brand rows — see this class's own siteSales header comment.
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
        // Every real brand's own channel group, in order, "Total" brand group last (built after the
        // loop from the union of every real brand's own site codes).
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
