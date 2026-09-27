package com.houseofbeauty.controller.pages.dashboard;

import com.houseofbeauty.dto.primarysales.response  .ProductLevelResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.TextMatch;
import com.houseofbeauty.service.dashboard.DashboardDailyTrendService;
import com.houseofbeauty.service.dashboard.DashboardGeoMapService;
import com.houseofbeauty.service.dashboard.DashboardOverviewService;
import com.houseofbeauty.service.dashboard.DashboardProductLevelService;
import com.houseofbeauty.service.topprojection.TopProjectionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// Backs the Dashboard (index.html) page's own Daily Sales Trends section and other panels.
@RestController
@RequestMapping("/api/dashboard")
@RequirePermission("page:dashboard")
public class DashboardController {

    private final DashboardGeoMapService dashboardGeoMapService;
    private final DashboardDailyTrendService dashboardDailyTrendService;
    private final DashboardProductLevelService dashboardProductLevelService;
    private final DashboardOverviewService dashboardOverviewService;
    private final TopProjectionService topProjectionService;

    public DashboardController(DashboardGeoMapService dashboardGeoMapService,
                                DashboardDailyTrendService dashboardDailyTrendService,
                                DashboardProductLevelService dashboardProductLevelService,
                                DashboardOverviewService dashboardOverviewService,
                                TopProjectionService topProjectionService) {
        this.dashboardGeoMapService = dashboardGeoMapService;
        this.dashboardDailyTrendService = dashboardDailyTrendService;
        this.dashboardProductLevelService = dashboardProductLevelService;
        this.dashboardOverviewService = dashboardOverviewService;
        this.topProjectionService = topProjectionService;
    }

    // Backs the Site Status page's Geo Map popup (GeoMap.js — moved there in full from this page's own
    // former "4. Geo Map" section; route/service names kept as-is, an internal implementation detail):
    // every distinct (City, State) site_master carries, with a site-row count — GeoMap.js matches
    // these against its own bundled census city list to highlight district/city coverage on the map
    // (see DashboardGeoMapService's own header comment).
    @GetMapping("/geo-map/site-cities")
    public ResponseEntity<List<Map<String, Object>>> getGeoMapSiteCities(@RequestParam(required = false) String status) {
        return ResponseEntity.ok(dashboardGeoMapService.getSiteCities(status));
    }

    // Click-through popup on a highlighted ("has-site") district: the real site_master rows located
    // in whichever real City name(s) GeoMap.js already matched into that district (repeatable
    // ?city=A&city=B query param).
    @GetMapping("/geo-map/sites")
    public ResponseEntity<List<Map<String, Object>>> getGeoMapSites(@RequestParam List<String> city,
                                                                       @RequestParam(required = false) String status) {
        return ResponseEntity.ok(dashboardGeoMapService.getSitesByCities(city, status));
    }

    // "2. Daily Sales Trends" brand pill options — real distinct Site_Master.Brand values, same
    // convention every other page's own /brands endpoint uses.
    @GetMapping("/brands")
    public ResponseEntity<List<String>> getAvailableBrands() {
        return ResponseEntity.ok(dashboardDailyTrendService.getAvailableBrands());
    }

    // Daily Sales Trends date filter's By Year range picklist.
    @GetMapping("/comparison2/years")
    public ResponseEntity<List<Integer>> getComparison2Years() {
        return ResponseEntity.ok(dashboardDailyTrendService.listYears());
    }

    // Daily Sales Trends section's real amount series: Total Sales = Primary_Sales + Secondary_Sales,
    // Total Target = Primary_Sales_Target + Secondary_Sales_Target by default (see
    // DashboardDailyTrendService's own header comment) — the "Sales Type" filter (salesType=all,
    // always the default/primary/secondary) restricts this to just one channel instead. channel/
    // status ("all" or one of GET /channels'/site_status pill's real values) are driven by the
    // "Filter Header" section's own Channel/Status pills, same vocabulary as /overview/*'s own
    // channel/status params — resolved inside the service itself (like brand/salesType already are
    // here) rather than by this controller. [from, to] default to the current calendar month when
    // omitted, same convention every other page's own /trend-range endpoint uses.
    @GetMapping("/trend-range")
    public ResponseEntity<Map<String, Object>> getTrendRange(@RequestParam(required = false) String from,
                                                                @RequestParam(required = false) String to,
                                                                @RequestParam(defaultValue = "day") String granularity,
                                                                @RequestParam(defaultValue = "all") String brand,
                                                                @RequestParam(defaultValue = "all") String salesType,
                                                                @RequestParam(defaultValue = "all") String channel,
                                                                @RequestParam(defaultValue = "all") String status) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(dashboardDailyTrendService.getTrendRange(parsedFrom, parsedTo, granularity, brand, salesType, channel, status));
    }

    // "1. Overview" Financial Year table — real per-month Primary_Sales_Target totals for the FY
    // starting April of fyStartYear (e.g. fyStartYear=2026 => Apr-2026..Mar-2027), optionally scoped
    // by the "Filter Header" section's own Sales Type/Brand/Channel/Status row. brand ("all"/"abh"/
    // "kylie", same vocabulary/normalization the Daily Sales Trends brand pill already uses) is
    // resolved via BrandFilter.product — DashboardOverviewService's own header comment explains why
    // that's the right vocabulary for every fact table this service queries. channel (one of
    // GET /channels' real values) and status (all/active/inactive/upcoming, same vocabulary Site
    // Insight's own Status pill uses) are passed through as-is; "all" on any of the three means no
    // filter.
    @GetMapping("/overview/primary-target")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewPrimaryTarget(@RequestParam int fyStartYear,
                                                                              @RequestParam(defaultValue = "all") String brand,
                                                                              @RequestParam(defaultValue = "all") String channel,
                                                                              @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getPrimarySalesTargetByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    // Same as /overview/primary-target above, for the "Secondary Sales" column group's Target instead
    // (Secondary_Sales_Target).
    @GetMapping("/overview/secondary-target")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewSecondaryTarget(@RequestParam int fyStartYear,
                                                                                @RequestParam(defaultValue = "all") String brand,
                                                                                @RequestParam(defaultValue = "all") String channel,
                                                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getSecondarySalesTargetByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    // "1. Overview" Financial Year table — real per-month Primary_Sales Actual Sales totals, same
    // FY-window shape and filter params as /overview/primary-target above.
    @GetMapping("/overview/primary-actual")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewPrimaryActual(@RequestParam int fyStartYear,
                                                                              @RequestParam(defaultValue = "all") String brand,
                                                                              @RequestParam(defaultValue = "all") String channel,
                                                                              @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getPrimarySalesActualByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    // Same as /overview/primary-actual above, for the "Secondary Sales" column group's Actual instead
    // (Secondary_Sales).
    @GetMapping("/overview/secondary-actual")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewSecondaryActual(@RequestParam int fyStartYear,
                                                                                @RequestParam(defaultValue = "all") String brand,
                                                                                @RequestParam(defaultValue = "all") String channel,
                                                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getSecondarySalesActualByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    // "1. Overview" current-month row — real Primary_Sales_Projection total for the real current
    // calendar month, scoped by the same Brand/Channel pills the other /overview/* endpoints already
    // respect (see resolveBrand/resolveChannel). Dashboard.js uses this as the current month's own
    // Primary Actual figure whenever that month has no real Primary_Sales rows yet (nobody's uploaded
    // this month's actual sales as of yet) — a real forward-looking estimate instead of a bare 0, styled
    // differently on screen so it doesn't read as a confirmed Actual number.
    @GetMapping("/overview/primary-projection")
    public ResponseEntity<BigDecimal> getOverviewPrimaryProjection(@RequestParam(defaultValue = "all") String brand,
                                                                      @RequestParam(defaultValue = "all") String channel) {
        return ResponseEntity.ok(topProjectionService.getProjectionTotalForMonth(YearMonth.now(), resolveBrand(brand), resolveChannel(channel)));
    }

    // "1. Overview" filter row's Channel pill options — real distinct Site_Master.Channel values,
    // same convention /brands above already uses for Brand.
    @GetMapping("/channels")
    public ResponseEntity<List<String>> getAvailableChannels() {
        return ResponseEntity.ok(dashboardOverviewService.getAvailableChannels());
    }

    // "Filter Header" section's own Sales Type pill options — real distinct Site_Master.Sales_Type
    // values ("Primary Sales"/"Secondary Sales" today), same convention /channels above already uses.
    @GetMapping("/sales-types")
    public ResponseEntity<List<String>> getAvailableSalesTypes() {
        return ResponseEntity.ok(dashboardOverviewService.getAvailableSalesTypes());
    }

    // "Filter Header" section's own Status pill options — see DashboardOverviewService.getAvailableStatuses's
    // own header comment for what this actually returns and when it falls back to an empty list.
    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(dashboardOverviewService.getAvailableStatuses());
    }

    // "3. Partner Wise Target Vs Achievement" own Partner column — real distinct Site_Master.Partner
    // values, scoped by the same "Filter Header" section's Sales Type/Brand/Channel/Status pills (see
    // setDashboardFyOverviewFilter in Dashboard.js, which refetches this on every one of those four
    // changing, alongside "1. Overview" and Daily Sales Trends).
    @GetMapping("/partners")
    public ResponseEntity<List<String>> getAvailablePartners(@RequestParam(defaultValue = "all") String salesType,
                                                                @RequestParam(defaultValue = "all") String brand,
                                                                @RequestParam(defaultValue = "all") String channel,
                                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getAvailablePartners(resolveSalesType(salesType), resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    // "3. Partner Wise Target Vs Achievement" own "YTD ..." column group's Target column — real
    // per-Partner Primary_Sales_Target + Secondary_Sales_Target total for [from, to] (the FY-start..
    // last-COMPLETE-month window Dashboard.js's own updateDashboardPartnerYtdLabel computes, "yyyy-MM"
    // e.g. "2026-04"), scoped by the same "Filter Header" Sales Type/Brand/Channel/Status pills every
    // other endpoint on this page already respects.
    @GetMapping("/partner-overview/target")
    public ResponseEntity<Map<String, BigDecimal>> getPartnerOverviewTarget(@RequestParam String from,
                                                                               @RequestParam String to,
                                                                               @RequestParam(defaultValue = "all") String salesType,
                                                                               @RequestParam(defaultValue = "all") String brand,
                                                                               @RequestParam(defaultValue = "all") String channel,
                                                                               @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getPartnerTargetTotals(YearMonth.parse(from), YearMonth.parse(to),
                resolveSalesType(salesType), resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    // Same as /partner-overview/target above, off real Primary_Sales/Secondary_Sales Actual Sales
    // instead — backs the "YTD ..." group's own Achi column. Dashboard.js also calls this a second time
    // with [from, to] shifted back one calendar year for the same group's own Vs LY column, rather than
    // this endpoint knowing anything about "last year" itself.
    @GetMapping("/partner-overview/actual")
    public ResponseEntity<Map<String, BigDecimal>> getPartnerOverviewActual(@RequestParam String from,
                                                                               @RequestParam String to,
                                                                               @RequestParam(defaultValue = "all") String salesType,
                                                                               @RequestParam(defaultValue = "all") String brand,
                                                                               @RequestParam(defaultValue = "all") String channel,
                                                                               @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getPartnerActualTotals(YearMonth.parse(from), YearMonth.parse(to),
                resolveSalesType(salesType), resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    // "3. Partner Wise Target Vs Achievement" Current Month group's own Projection column — real
    // per-Partner Primary_Sales_Projection total for the CURRENT calendar month (that table only ever
    // holds the live month's own data — see TopProjectionService's own header comment), scoped by
    // Brand/Channel same as /overview/primary-projection above. Dashboard.js only ever uses this as a
    // stand-in for a partner whose real Primary Sales actual is still 0 so far this month — same "1.
    // Overview" convention that endpoint already follows for the FY table's own current-month row.
    // Re-keyed here to TextMatch.normalize (lowercased/trimmed) so the frontend can look this map up
    // by the exact same lowercased Partner key every other partner-overview map on this page already
    // uses (see getPartnerTargetTotals/getPartnerActualTotals) — TopProjectionService itself keeps the
    // raw spelling instead, since PrimarySalesReportsService's own unrelated caller needs that (see
    // that method's own header comment).
    @GetMapping("/partner-overview/projection")
    public ResponseEntity<Map<String, BigDecimal>> getPartnerOverviewProjection(@RequestParam(defaultValue = "all") String brand,
                                                                                   @RequestParam(defaultValue = "all") String channel) {
        Map<String, BigDecimal> raw = topProjectionService.getLatestProjectionsByPartnerInRange(
                YearMonth.now(), YearMonth.now(), resolveBrand(brand), resolveChannel(channel));
        Map<String, BigDecimal> normalized = new HashMap<>();
        raw.forEach((partner, total) -> {
            if (partner != null) {
                normalized.merge(TextMatch.normalize(partner), total, BigDecimal::add);
            }
        });
        return ResponseEntity.ok(normalized);
    }

    // "primary"/"secondary" (the Sales Type pill's own short codes, see Dashboard.js's own
    // salesTypeToCode) -> Site_Master.Sales_Type's real stored values; "all" (or anything else) means
    // no filter, same convention resolveChannel below already follows.
    private String resolveSalesType(String salesType) {
        if ("primary".equalsIgnoreCase(salesType)) {
            return "Primary Sales";
        }
        if ("secondary".equalsIgnoreCase(salesType)) {
            return "Secondary Sales";
        }
        return null;
    }

    private String resolveBrand(String brand) {
        return BrandFilter.product(BrandFilter.normalize(brand));
    }

    private String resolveChannel(String channel) {
        return (channel == null || channel.isBlank() || "all".equalsIgnoreCase(channel)) ? null : channel;
    }

    // "all"/blank means no Status filter; any other value (active/inactive/upcoming) is passed
    // through as-is — OperationalStatusFilter.whereClause itself already falls back to "no filter"
    // for anything it doesn't recognize, same convention resolveChannel above follows for Channel.
    private String resolveStatus(String status) {
        return (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) ? null : status;
    }

    // "3. Product Snapshot" — exact reuse of the Primary Sales Page's own Product Snapshot backend
    // (see DashboardProductLevelService's own header comment), same endpoint shape as that page's
    // /api/primary-sales/product-level. [from, to] default to the current calendar month-to-date
    // when omitted, same convention as every other endpoint in this controller.
    @GetMapping("/product-level")
    public ResponseEntity<ProductLevelResponse> getProductLevel(@RequestParam(required = false) String from,
                                                                  @RequestParam(required = false) String to,
                                                                  @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(dashboardProductLevelService.getProductLevel(parsedFrom, parsedTo, brand));
    }
}
