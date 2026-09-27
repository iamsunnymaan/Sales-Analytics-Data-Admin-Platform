package com.houseofbeauty.controller.pages.primarysales;

import com.houseofbeauty.controller.common.BaseCrudController;
import com.houseofbeauty.dto.primarysales.response.MonthlyBreakdownEntry;
import com.houseofbeauty.dto.primarysales.response.MonthlySalesResponse;
import com.houseofbeauty.dto.primarysales.response.ProductLevelResponse;
import com.houseofbeauty.dto.primarysales.response.TrendRangeResponse;
import com.houseofbeauty.model.PrimarySale;
import com.houseofbeauty.repository.PrimarySaleRepository;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.primarysales.PrimarySalesDailyTrendService;
import com.houseofbeauty.service.primarysales.PrimarySalesProductLevelService;
import com.houseofbeauty.service.primarysales.PrimarySalesReportsService;
import com.houseofbeauty.service.primarysales.PrimarySalesTodayService;
import com.houseofbeauty.service.primarysales.PrimarySalesYearTrendService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/primary-sales")
@RequirePermission("page:primary-sales")
// Plain CRUD endpoints for primary_sales — all logic lives in BaseCrudController — plus
// /comparison2/years (Sales Comparison 02 section's Year checkbox list), /trend-range (Daily
// Trend Graph section), /product-level (Product Level section's Category/SubCategory + Top
// Products tables), /monthly, /monthly/breakdown (Overview section's Monthly Sales /
// Current Month Target / MTD Sales / Month Projection cards), and /reports/brand-hierarchy,
// /reports/channels, /reports/subchannels, /reports/partners, /reports/brands-summary ("4. Reports"
// section's tabs — exact mirror of SecondarySaleController's own equivalents, see
// PrimarySalesReportsService's own header comment). /product-level shares the same [from, to] window
// as the Overview section's shared Filter (see PrimarySalesPage.js Page wiring) — a month-range pick
// there re-scopes every section at once, not just Overview. The Overview section's Brand pill is
// wired the same way into all of them too — see each endpoint's own comment. Reports' own four tabs
// are the one exception: no Brand-filter pill (always "all" brands, same as Secondary's version), but
// they DO follow the same shared Filter. CHANGED 2026-09-03 (four times): "4. Reports" was removed,
// REBUILT, removed again, then rebuilt once more as an exact copy of Secondary's own Reports section
// — see PrimarySalesReportsService's own header comment. "5. Site_Master Primary_Sale Report" (and
// its own /reports/site-master endpoint) was removed for good per explicit request — see
// PrimarySalesReportsService's own header comment.
public class PrimarySaleController extends BaseCrudController<PrimarySale, Long> {

    private final PrimarySalesYearTrendService primarySalesYearTrendService;
    private final PrimarySalesDailyTrendService primarySalesDailyTrendService;
    private final PrimarySalesProductLevelService primarySalesProductLevelService;
    private final PrimarySalesTodayService primarySalesTodayService;
    private final PrimarySalesReportsService primarySalesReportsService;

    public PrimarySaleController(PrimarySaleRepository repository,
                                  PrimarySalesYearTrendService primarySalesYearTrendService,
                                  PrimarySalesDailyTrendService primarySalesDailyTrendService,
                                  PrimarySalesProductLevelService primarySalesProductLevelService,
                                  PrimarySalesTodayService primarySalesTodayService,
                                  PrimarySalesReportsService primarySalesReportsService) {
        super(repository);
        this.primarySalesYearTrendService = primarySalesYearTrendService;
        this.primarySalesDailyTrendService = primarySalesDailyTrendService;
        this.primarySalesProductLevelService = primarySalesProductLevelService;
        this.primarySalesTodayService = primarySalesTodayService;
        this.primarySalesReportsService = primarySalesReportsService;
    }

    // Year picklist for the Sales Comparison 02 section's Year checkbox list.
    @GetMapping("/comparison2/years")
    public ResponseEntity<List<Integer>> getComparison2Years() {
        return ResponseEntity.ok(primarySalesYearTrendService.listYears());
    }

    // Brand pill options for both brand-header rows on this page (Overview's shared pill and Daily
    // Trend Graph's own pill) — real distinct Site_Master.Brand values, "All" prepended on the
    // frontend. See PrimarySalesTodayService.getAvailableBrands's own comment.
    @GetMapping("/brands")
    public ResponseEntity<List<String>> getAvailableBrands() {
        return ResponseEntity.ok(primarySalesTodayService.getAvailableBrands());
    }

    // Channel pill options for the Filter Header — real distinct Site_Master.Channel values scoped
    // to Sales_Type = 'Primary Sales', "All" prepended on the frontend. See
    // PrimarySalesTodayService.getAvailableChannels's own comment.
    @GetMapping("/channels")
    public ResponseEntity<List<String>> getAvailableChannels() {
        return ResponseEntity.ok(primarySalesTodayService.getAvailableChannels());
    }

    // Status pill options for the Filter Header — "All" prepended on the frontend, same convention
    // /brands and /channels above already follow. See PrimarySalesTodayService.getAvailableStatuses's
    // own comment for why this is a real fetch (Not Available on failure, same as Brand/Channel)
    // rather than a hardcoded frontend array.
    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(primarySalesTodayService.getAvailableStatuses());
    }

    // Daily Trend Graph section's real amount series, bucketed by whichever x-axis granularity the
    // frontend's active SalesDateFilter mode implies: "day" for a single selected month, "month" for
    // an arbitrary date range, "year" for a year range. [from, to] default to the current calendar
    // month when omitted, matching /product-level's convention. `channel` ("all" or a real
    // Site_Master.Channel value, "all" = no filter) and `status` (all/active/inactive/upcoming, same
    // vocabulary Site Insight's own Status pill uses) wire the Filter Header's shared Channel/Status
    // pills in — see PrimarySalesDailyTrendService.getTrendRange's own comment for how (Bill_to IN
    // (...), not a direct Site_Master join).
    @GetMapping("/trend-range")
    public ResponseEntity<TrendRangeResponse> getTrendRange(@RequestParam(required = false) String from,
                                              @RequestParam(required = false) String to,
                                              @RequestParam(defaultValue = "day") String granularity,
                                              @RequestParam(defaultValue = "all") String brand,
                                              @RequestParam(defaultValue = "all") String channel,
                                              @RequestParam(defaultValue = "all") String status) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesDailyTrendService.getTrendRange(parsedFrom, parsedTo, granularity, brand, channel, resolveStatus(status)));
    }

    // Product Level section: Category/SubCategory ranked tables (sales + vs LY% + vs LM%) and
    // Top-10-by-value / Top-10-by-qty product lists, scoped to the page's date filter window
    // (defaults to the current calendar month when from/to are omitted), brand, and now the Filter
    // Header's shared Channel/Status pills too (same "all" = no filter convention as brand).
    @GetMapping("/product-level")
    public ResponseEntity<ProductLevelResponse> getProductLevel(@RequestParam(required = false) String from,
                                                @RequestParam(required = false) String to,
                                                @RequestParam(defaultValue = "all") String brand,
                                                @RequestParam(defaultValue = "all") String channel,
                                                @RequestParam(defaultValue = "all") String status) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesProductLevelService.getProductLevel(parsedFrom, parsedTo, brand, channel, resolveStatus(status)));
    }

    // Overview Insights card: real Period Sales / Period Target / Projection figures, genuinely
    // summed across whatever [from, to] month range the Insights card's own Filter has selected
    // (defaults to the current calendar month-to-date when omitted), scoped to the page's Brand pill
    // ("all", "abh", or "kylie"), the Filter Header's shared Channel pill ("all" or a real
    // Site_Master.Channel value), and its shared Status pill (all/active/inactive/upcoming).
    @GetMapping("/monthly")
    public ResponseEntity<MonthlySalesResponse> getMonthlySales(@RequestParam(defaultValue = "all") String brand,
                                                @RequestParam(required = false) String from,
                                                @RequestParam(required = false) String to,
                                                @RequestParam(defaultValue = "all") String channel,
                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(primarySalesTodayService.getMonthlySales(brand, parseDate(from), parseDate(to), channel, resolveStatus(status)));
    }

    // Monthly Sales card's Outstanding popup: one row per month, January through `asOf`'s month
    // (year-to-date), real actual sales and real per-month target.
    @GetMapping("/monthly/breakdown")
    public ResponseEntity<List<MonthlyBreakdownEntry>> getMonthlyBreakdown(@RequestParam(defaultValue = "all") String brand,
                                                           @RequestParam(required = false) String asOf) {
        return ResponseEntity.ok(primarySalesTodayService.getMonthlyBreakdown(brand, parseDate(asOf)));
    }

    // Reports "All Report" tab: real Brand -> Channel -> Sub_Channel -> Partner tree, each node's own
    // real Mnt/MTD Sales — see PrimarySalesReportsService#getBrandHierarchy's own header comment.
    // Sourced ONLY from site_master/Primary_Sales/Primary_Sales_Target, never Secondary_Sales.
    // from/to default to the current calendar month-to-date when omitted, same convention as
    // /product-level above. `brand` ("all"/"abh"/"kylie") is always "all" from the frontend (Reports
    // has no Brand-filter pill of its own, same as Secondary's version) but stays a real param for
    // parity with every other brand-filterable endpoint here.
    @GetMapping("/reports/brand-hierarchy")
    public ResponseEntity<List<Map<String, Object>>> getReportsBrandHierarchy(@RequestParam(required = false) String from,
                                                                                 @RequestParam(required = false) String to,
                                                                                 @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getBrandHierarchy(parsedFrom, parsedTo, brand));
    }

    // Reports "Channel" tab — flat one-row-per-Channel summary. Same from/to/brand convention as
    // /reports/brand-hierarchy above.
    @GetMapping("/reports/channels")
    public ResponseEntity<List<Map<String, Object>>> getReportsChannels(@RequestParam(required = false) String from,
                                                                          @RequestParam(required = false) String to,
                                                                          @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getChannelSummaries(parsedFrom, parsedTo, brand));
    }

    // Reports "Sub-Channel" tab — flat one-row-per-Sub_Channel summary. Same from/to/brand convention
    // as /reports/brand-hierarchy above.
    @GetMapping("/reports/subchannels")
    public ResponseEntity<List<Map<String, Object>>> getReportsSubChannels(@RequestParam(required = false) String from,
                                                                              @RequestParam(required = false) String to,
                                                                              @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getSubChannelSummaries(parsedFrom, parsedTo, brand));
    }

    // Reports "Partner" tab — flat one-row-per-Partner summary. Same from/to/brand convention as
    // /reports/brand-hierarchy above.
    @GetMapping("/reports/partners")
    public ResponseEntity<List<Map<String, Object>>> getReportsPartners(@RequestParam(required = false) String from,
                                                                           @RequestParam(required = false) String to,
                                                                           @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getPartnerSummaries(parsedFrom, parsedTo, brand));
    }

    // Reports "Brand" tab — every real Site_Master Brand, flattened (same shape as /reports/channels,
    // just a different Site_Master column). Not wired into the frontend's tab toggle, exact parity
    // with SecondarySaleController's own /reports/brands-summary (Brand-level rows are already
    // visible via /reports/brand-hierarchy's own top level) — kept as a ready-made building block.
    @GetMapping("/reports/brands-summary")
    public ResponseEntity<List<Map<String, Object>>> getReportsBrandSummaries(@RequestParam(required = false) String from,
                                                                                 @RequestParam(required = false) String to,
                                                                                 @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getBrandSummaries(parsedFrom, parsedTo, brand));
    }

    private LocalDate parseDate(String date) {
        return (date == null || date.isBlank()) ? null : LocalDate.parse(date);
    }

    // "all"/blank means no Status filter; any other value (active/inactive/upcoming) is passed
    // through as-is — OperationalStatusFilter itself already falls back to "no filter" for anything it
    // doesn't recognize, same convention DashboardController's own resolveStatus follows.
    private String resolveStatus(String status) {
        return (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) ? null : status;
    }
}
