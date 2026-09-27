package com.houseofbeauty.controller.pages.sitedetail;

import com.houseofbeauty.dto.sitedetail.response.ProductLevelResponse;
import com.houseofbeauty.dto.sitedetail.response.TrendRangeResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.sitedetail.SiteDetailProductLevelService;
import com.houseofbeauty.service.sitedetail.SiteDetailService;
import com.houseofbeauty.service.sitedetail.SiteDetailTrendService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

// Backs the Site Status page's site detail view (SiteStatusPage.html/.js), reached by picking a Site
// Code/Brand there directly or via the Dashboard Geo Map's district click-through popup deep-linking
// in with ?siteCode=&brand= (GeoMap.js).
@RestController
@RequestMapping("/api/site-detail")
@RequirePermission("page:site-insights")
public class SiteDetailController {

    private final SiteDetailService siteDetailService;
    private final SiteDetailTrendService siteDetailTrendService;
    private final SiteDetailProductLevelService siteDetailProductLevelService;

    public SiteDetailController(SiteDetailService siteDetailService, SiteDetailTrendService siteDetailTrendService,
                                 SiteDetailProductLevelService siteDetailProductLevelService) {
        this.siteDetailService = siteDetailService;
        this.siteDetailTrendService = siteDetailTrendService;
        this.siteDetailProductLevelService = siteDetailProductLevelService;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> getSiteDetail(@RequestParam String siteCode, @RequestParam String brand) {
        return ResponseEntity.ok(siteDetailService.getSiteDetail(siteCode, brand));
    }

    // "Sales Trend" card's own real Primary/Secondary/Total series (+ Target overlay), bucketed by
    // whichever x-axis granularity the card's own SalesDateFilter mode implies — same [from, to]/
    // granularity contract as Primary Sales' own /trend-range (see SiteDetailTrendService).
    @GetMapping("/trend-range")
    public ResponseEntity<TrendRangeResponse> getTrendRange(@RequestParam String siteCode, @RequestParam String brand,
                                                              @RequestParam(required = false) String from,
                                                              @RequestParam(required = false) String to,
                                                              @RequestParam(defaultValue = "day") String granularity) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(siteDetailTrendService.getTrendRange(siteCode, brand, parsedFrom, parsedTo, granularity));
    }

    // "Sales Trend" card's own date filter — "By Year" mode's Year picklist, scoped to this one real
    // (Site_Code, Brand) site rather than every site's own years (see SiteDetailTrendService).
    @GetMapping("/trend-years")
    public ResponseEntity<List<Integer>> getTrendYears(@RequestParam String siteCode, @RequestParam String brand) {
        return ResponseEntity.ok(siteDetailTrendService.getYearsWithData(siteCode, brand));
    }

    // "Product Snapshot" section's ranking table — this site's own products, ranked by Sales at all
    // three levels (Product/Category/Sub-category) at once, scoped to [from, to] (defaults to the
    // current calendar month, same convention /trend-range uses when omitted).
    @GetMapping("/product-level")
    public ResponseEntity<ProductLevelResponse> getProductLevel(@RequestParam String siteCode, @RequestParam String brand,
                                                                   @RequestParam(required = false) String from,
                                                                   @RequestParam(required = false) String to) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(siteDetailProductLevelService.getProductLevel(siteCode, brand, parsedFrom, parsedTo));
    }

    // "Primary/Secondary Sales — Recent Transactions" section's own rows-to-show dropdown
    // (SiteStatusPage.js's wireTransactionLimitControls) — re-fetches just this one table's rows at a
    // caller-picked size instead of the getSiteDetail default (SiteDetailService's own
    // TRANSACTIONS_LIMIT, 200), without re-fetching the whole page's profile/KPIs/monthly history.
    // limit is clamped (never trusted as-is — it's interpolated straight into a SQL TOP N) to a
    // sane [1, 5000] range regardless of what the dropdown itself offers.
    @GetMapping("/transactions")
    public ResponseEntity<Map<String, Object>> getTransactions(@RequestParam String siteCode, @RequestParam String brand,
                                                                  @RequestParam String type,
                                                                  @RequestParam(defaultValue = "200") int limit) {
        int clampedLimit = Math.max(1, Math.min(limit, 5000));
        Map<String, Object> result = "secondary".equalsIgnoreCase(type)
                ? siteDetailService.getSecondaryTransactions(siteCode, brand, clampedLimit)
                : siteDetailService.getPrimaryTransactions(siteCode, brand, clampedLimit);
        return ResponseEntity.ok(result);
    }
}
