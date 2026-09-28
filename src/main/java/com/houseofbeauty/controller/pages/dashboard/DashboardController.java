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

    @GetMapping("/geo-map/site-cities")
    public ResponseEntity<List<Map<String, Object>>> getGeoMapSiteCities(@RequestParam(required = false) String status) {
        return ResponseEntity.ok(dashboardGeoMapService.getSiteCities(status));
    }

    @GetMapping("/geo-map/sites")
    public ResponseEntity<List<Map<String, Object>>> getGeoMapSites(@RequestParam List<String> city,
                                                                       @RequestParam(required = false) String status) {
        return ResponseEntity.ok(dashboardGeoMapService.getSitesByCities(city, status));
    }

    @GetMapping("/brands")
    public ResponseEntity<List<String>> getAvailableBrands() {
        return ResponseEntity.ok(dashboardDailyTrendService.getAvailableBrands());
    }

    @GetMapping("/comparison2/years")
    public ResponseEntity<List<Integer>> getComparison2Years() {
        return ResponseEntity.ok(dashboardDailyTrendService.listYears());
    }

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

    @GetMapping("/overview/primary-target")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewPrimaryTarget(@RequestParam int fyStartYear,
                                                                              @RequestParam(defaultValue = "all") String brand,
                                                                              @RequestParam(defaultValue = "all") String channel,
                                                                              @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getPrimarySalesTargetByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    @GetMapping("/overview/secondary-target")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewSecondaryTarget(@RequestParam int fyStartYear,
                                                                                @RequestParam(defaultValue = "all") String brand,
                                                                                @RequestParam(defaultValue = "all") String channel,
                                                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getSecondarySalesTargetByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    @GetMapping("/overview/primary-actual")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewPrimaryActual(@RequestParam int fyStartYear,
                                                                              @RequestParam(defaultValue = "all") String brand,
                                                                              @RequestParam(defaultValue = "all") String channel,
                                                                              @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getPrimarySalesActualByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    @GetMapping("/overview/secondary-actual")
    public ResponseEntity<Map<String, BigDecimal>> getOverviewSecondaryActual(@RequestParam int fyStartYear,
                                                                                @RequestParam(defaultValue = "all") String brand,
                                                                                @RequestParam(defaultValue = "all") String channel,
                                                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getSecondarySalesActualByMonth(fyStartYear, resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

    @GetMapping("/overview/primary-projection")
    public ResponseEntity<BigDecimal> getOverviewPrimaryProjection(@RequestParam(defaultValue = "all") String brand,
                                                                      @RequestParam(defaultValue = "all") String channel) {
        return ResponseEntity.ok(topProjectionService.getProjectionTotalForMonth(YearMonth.now(), resolveBrand(brand), resolveChannel(channel)));
    }

    @GetMapping("/channels")
    public ResponseEntity<List<String>> getAvailableChannels() {
        return ResponseEntity.ok(dashboardOverviewService.getAvailableChannels());
    }

    @GetMapping("/sales-types")
    public ResponseEntity<List<String>> getAvailableSalesTypes() {
        return ResponseEntity.ok(dashboardOverviewService.getAvailableSalesTypes());
    }

    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(dashboardOverviewService.getAvailableStatuses());
    }

    @GetMapping("/partners")
    public ResponseEntity<List<String>> getAvailablePartners(@RequestParam(defaultValue = "all") String salesType,
                                                                @RequestParam(defaultValue = "all") String brand,
                                                                @RequestParam(defaultValue = "all") String channel,
                                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(dashboardOverviewService.getAvailablePartners(resolveSalesType(salesType), resolveBrand(brand), resolveChannel(channel), resolveStatus(status)));
    }

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

    private String resolveStatus(String status) {
        return (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) ? null : status;
    }

    @GetMapping("/product-level")
    public ResponseEntity<ProductLevelResponse> getProductLevel(@RequestParam(required = false) String from,
                                                                  @RequestParam(required = false) String to,
                                                                  @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(dashboardProductLevelService.getProductLevel(parsedFrom, parsedTo, brand));
    }
}
