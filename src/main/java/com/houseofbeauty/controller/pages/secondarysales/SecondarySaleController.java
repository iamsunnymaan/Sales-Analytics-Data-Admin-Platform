package com.houseofbeauty.controller.pages.secondarysales;

import com.houseofbeauty.dto.primarysales.response.ProductLevelResponse;
import com.houseofbeauty.dto.secondarysales.response.OverviewResponse;
import com.houseofbeauty.dto.secondarysales.response.TrendRangeResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.ChannelFilter;
import com.houseofbeauty.service.secondarysales.SecondarySalesDailyTrendService;
import com.houseofbeauty.service.secondarysales.SecondarySalesOverviewService;
import com.houseofbeauty.service.secondarysales.SecondarySalesProductLevelService;
import com.houseofbeauty.service.secondarysales.SecondarySalesReportsService;
import com.houseofbeauty.service.secondarysales.SecondarySalesYearTrendService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

// Backs the Secondary Sales page's "Filter Header" (shared Brand/Channel/Status/Date), "1. Overview",
// "2. Daily Sales Trends", "3. Product Snapshot", "4. Reports", and "5. Site_Master Secondary_Sale
// Report" sections, mirroring PrimarySaleController's own equivalents. No CRUD here (unlike
// PrimarySaleController, which extends BaseCrudController) — not requested for either section.
// The Filter Header's shared Brand/Channel/Status pills wire into /overview, /trend-range,
// /product-level, and /reports/site-master-secondary-sale — "4. Reports" (/reports/brand-hierarchy,
// /channels, /brands-summary, /subchannels, /partners) is the one exception, always "all" brand and
// no channel/status param at all, per explicit request (only the Filter Header's Date reaches it).
@RestController
@RequestMapping("/api/secondary-sales")
@RequirePermission("page:secondary-sales")
public class SecondarySaleController {

    private final SecondarySalesDailyTrendService secondarySalesDailyTrendService;
    private final SecondarySalesYearTrendService secondarySalesYearTrendService;
    private final SecondarySalesReportsService secondarySalesReportsService;
    private final SecondarySalesOverviewService secondarySalesOverviewService;
    private final SecondarySalesProductLevelService secondarySalesProductLevelService;

    public SecondarySaleController(SecondarySalesDailyTrendService secondarySalesDailyTrendService,
                                    SecondarySalesYearTrendService secondarySalesYearTrendService,
                                    SecondarySalesReportsService secondarySalesReportsService,
                                    SecondarySalesOverviewService secondarySalesOverviewService,
                                    SecondarySalesProductLevelService secondarySalesProductLevelService) {
        this.secondarySalesDailyTrendService = secondarySalesDailyTrendService;
        this.secondarySalesYearTrendService = secondarySalesYearTrendService;
        this.secondarySalesReportsService = secondarySalesReportsService;
        this.secondarySalesOverviewService = secondarySalesOverviewService;
        this.secondarySalesProductLevelService = secondarySalesProductLevelService;
    }

    // "3. Product Snapshot" section: Category -> Sub-category -> Product tree + Product Ranking
    // panel, same endpoint shape as Primary Sales' own /product-level (PrimarySalesProductLevelService)
    // and Dashboard's /product-level, but reading ONLY Secondary_Sales (see
    // SecondarySalesProductLevelService's own header comment on the strict data isolation). [from, to]
    // default to the current calendar month-to-date when omitted, same convention every other
    // endpoint here follows. `channel`/`status` ("all" = no filter) wire the Filter Header's shared
    // Channel/Status pills in.
    @GetMapping("/product-level")
    public ResponseEntity<ProductLevelResponse> getProductLevel(@RequestParam(required = false) String from,
                                                                  @RequestParam(required = false) String to,
                                                                  @RequestParam(defaultValue = "all") String brand,
                                                                  @RequestParam(defaultValue = "all") String channel,
                                                                  @RequestParam(defaultValue = "all") String status) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesProductLevelService.getProductLevel(parsedFrom, parsedTo, brand, channel, resolveStatus(status)));
    }

    // "1. Overview" cross-tab: real Brand columns x real Channel sub-columns. [from, to] default to
    // the current calendar month-to-date when omitted, same convention every other endpoint here
    // follows. brand/channel/status ("all" = no filter) wire the Filter Header's shared Brand/Channel/
    // Status pills in — a specific value narrows the cross-tab down to just that one real Brand/
    // Channel (plus its own synthesized "Total"), see SecondarySalesOverviewService#getOverview's own
    // header comment.
    @GetMapping("/overview")
    public ResponseEntity<OverviewResponse> getOverview(@RequestParam(required = false) String from,
                                                         @RequestParam(required = false) String to,
                                                         @RequestParam(defaultValue = "all") String brand,
                                                         @RequestParam(defaultValue = "all") String channel,
                                                         @RequestParam(defaultValue = "all") String status) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesOverviewService.getOverview(parsedFrom, parsedTo, brand, channel, resolveStatus(status)));
    }

    // Status pill options for the Filter Header — "All" prepended on the frontend, same convention
    // /brands and /channels above already follow. See
    // SecondarySalesOverviewService.getAvailableStatuses's own comment for why this is a real fetch
    // ("Not Available" on failure, same as Brand/Channel) rather than a hardcoded frontend array —
    // exact mirror of PrimarySaleController's own /statuses.
    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(secondarySalesOverviewService.getAvailableStatuses());
    }

    // Year picklist for the Daily Sales Trends date filter's By Year range.
    @GetMapping("/comparison2/years")
    public ResponseEntity<List<Integer>> getComparison2Years() {
        return ResponseEntity.ok(secondarySalesYearTrendService.listYears());
    }

    // Filter Header's Brand pill options — real distinct Site_Master.Brand values, "All" prepended
    // on the frontend (same convention as PrimarySaleController's own /brands).
    @GetMapping("/brands")
    public ResponseEntity<List<String>> getAvailableBrands() {
        return ResponseEntity.ok(secondarySalesDailyTrendService.getAvailableBrands());
    }

    // Filter Header's Channel pill options — real distinct Site_Master.Channel values scoped to
    // Sales_Type = 'Secondary Sales', "All" prepended on the frontend. See
    // SecondarySalesOverviewService.getAvailableChannels's own comment.
    @GetMapping("/channels")
    public ResponseEntity<List<String>> getAvailableChannels() {
        return ResponseEntity.ok(secondarySalesOverviewService.getAvailableChannels());
    }

    // Daily Sales Trends section's real amount series: "day" bucketing for a single selected month,
    // "month" for an arbitrary date range, "year" for a year range. [from, to] default to the
    // current calendar month when omitted. `channel`/`status` ("all" = no filter) wire the Filter
    // Header's shared Channel/Status pills in — see
    // SecondarySalesDailyTrendService.getTrendRange's own comment for how (Site_Code IN (...), not a
    // direct Site_Master join).
    @GetMapping("/trend-range")
    public ResponseEntity<TrendRangeResponse> getTrendRange(@RequestParam(required = false) String from,
                                              @RequestParam(required = false) String to,
                                              @RequestParam(defaultValue = "day") String granularity,
                                              @RequestParam(defaultValue = "all") String brand,
                                              @RequestParam(defaultValue = "all") String channel,
                                              @RequestParam(defaultValue = "all") String status) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesDailyTrendService.getTrendRange(parsedFrom, parsedTo, granularity, brand, channel, resolveStatus(status)));
    }

    // Reports "All Report" tab: real Brand -> Channel -> Sub_Channel -> Partner tree. [from, to]
    // default to the current calendar month-to-date when omitted (this section has no date-range
    // Filter UI of its own, so callers always omit them today). `brand` is always "all" from the
    // frontend (Reports has no Brand/Channel pill of its own, per explicit request — only the Filter
    // Header's Date reaches it) but stays a real param for parity with every other endpoint here.
    @GetMapping("/reports/brand-hierarchy")
    public ResponseEntity<List<Map<String, Object>>> getBrandHierarchy(@RequestParam(required = false) String from,
                                                                        @RequestParam(required = false) String to,
                                                                        @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getBrandHierarchy(parsedFrom, parsedTo, brand));
    }

    // Reports "Channel" tab: every real Site_Master Channel, flattened.
    @GetMapping("/reports/channels")
    public ResponseEntity<List<Map<String, Object>>> getChannelSummaries(@RequestParam(required = false) String from,
                                                                          @RequestParam(required = false) String to,
                                                                          @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getChannelSummaries(parsedFrom, parsedTo, brand));
    }

    // Reports "Brand" tab: every real Site_Master Brand, flattened (same shape as /reports/channels,
    // just a different Site_Master column) — per explicit request, alongside "All Report"'s own
    // Brand->Channel->Sub_Channel->Partner tree.
    @GetMapping("/reports/brands-summary")
    public ResponseEntity<List<Map<String, Object>>> getBrandSummaries(@RequestParam(required = false) String from,
                                                                        @RequestParam(required = false) String to,
                                                                        @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getBrandSummaries(parsedFrom, parsedTo, brand));
    }

    // Reports "Sub-Channel" tab: every real Site_Master Sub_Channel, flattened.
    @GetMapping("/reports/subchannels")
    public ResponseEntity<List<Map<String, Object>>> getSubChannelSummaries(@RequestParam(required = false) String from,
                                                                             @RequestParam(required = false) String to,
                                                                             @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getSubChannelSummaries(parsedFrom, parsedTo, brand));
    }

    // Reports "Partner" tab: every real Site_Master Partner, flattened.
    @GetMapping("/reports/partners")
    public ResponseEntity<List<Map<String, Object>>> getPartnerSummaries(@RequestParam(required = false) String from,
                                                                          @RequestParam(required = false) String to,
                                                                          @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getPartnerSummaries(parsedFrom, parsedTo, brand));
    }

    // "5. Site_Master Secondary_Sale Report" section: every real site_master row whose own
    // Sales_Type = 'Secondary Sales', ranked by real Secondary_Sales Actual Sales descending,
    // with real Secondary_Sales_Target MNT — see SecondarySalesReportsService#
    // getSiteMasterSecondarySaleReport's own header comment. [from, to] default to the current
    // calendar month-to-date when omitted. `brand`/`channel`/`status` ("all" = no filter) wire the
    // Filter Header's shared Brand/Channel/Status pills in per explicit request — brand is converted
    // to Site_Master's own vocabulary (BrandFilter#product — confirmed live, Secondary's own
    // Site_Master.Brand stores full names, NOT Primary's short-code form) since this endpoint
    // filters site_master.Brand directly, same conversion getOverview above already uses.
    @GetMapping("/reports/site-master-secondary-sale")
    public ResponseEntity<List<Map<String, Object>>> getSiteMasterSecondarySaleReport(@RequestParam(required = false) String from,
                                                                                         @RequestParam(required = false) String to,
                                                                                         @RequestParam(defaultValue = "all") String brand,
                                                                                         @RequestParam(defaultValue = "all") String channel,
                                                                                         @RequestParam(defaultValue = "all") String status) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        String siteMasterBrand = BrandFilter.product(BrandFilter.normalize(brand));
        String channelFilter = ChannelFilter.normalize(channel);
        return ResponseEntity.ok(secondarySalesReportsService.getSiteMasterSecondarySaleReport(parsedFrom, parsedTo, siteMasterBrand, channelFilter, resolveStatus(status)));
    }

    // "all"/blank means no Status filter; any other value (active/inactive/upcoming) is passed
    // through as-is — OperationalStatusFilter itself already falls back to "no filter" for anything it
    // doesn't recognize, same convention PrimarySaleController's own resolveStatus follows.
    private String resolveStatus(String status) {
        return (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) ? null : status;
    }
}
