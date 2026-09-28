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

    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(secondarySalesOverviewService.getAvailableStatuses());
    }

    @GetMapping("/comparison2/years")
    public ResponseEntity<List<Integer>> getComparison2Years() {
        return ResponseEntity.ok(secondarySalesYearTrendService.listYears());
    }

    @GetMapping("/brands")
    public ResponseEntity<List<String>> getAvailableBrands() {
        return ResponseEntity.ok(secondarySalesDailyTrendService.getAvailableBrands());
    }

    @GetMapping("/channels")
    public ResponseEntity<List<String>> getAvailableChannels() {
        return ResponseEntity.ok(secondarySalesOverviewService.getAvailableChannels());
    }

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

    @GetMapping("/reports/brand-hierarchy")
    public ResponseEntity<List<Map<String, Object>>> getBrandHierarchy(@RequestParam(required = false) String from,
                                                                        @RequestParam(required = false) String to,
                                                                        @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getBrandHierarchy(parsedFrom, parsedTo, brand));
    }

    @GetMapping("/reports/channels")
    public ResponseEntity<List<Map<String, Object>>> getChannelSummaries(@RequestParam(required = false) String from,
                                                                          @RequestParam(required = false) String to,
                                                                          @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getChannelSummaries(parsedFrom, parsedTo, brand));
    }

    @GetMapping("/reports/brands-summary")
    public ResponseEntity<List<Map<String, Object>>> getBrandSummaries(@RequestParam(required = false) String from,
                                                                        @RequestParam(required = false) String to,
                                                                        @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getBrandSummaries(parsedFrom, parsedTo, brand));
    }

    @GetMapping("/reports/subchannels")
    public ResponseEntity<List<Map<String, Object>>> getSubChannelSummaries(@RequestParam(required = false) String from,
                                                                             @RequestParam(required = false) String to,
                                                                             @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getSubChannelSummaries(parsedFrom, parsedTo, brand));
    }

    @GetMapping("/reports/partners")
    public ResponseEntity<List<Map<String, Object>>> getPartnerSummaries(@RequestParam(required = false) String from,
                                                                          @RequestParam(required = false) String to,
                                                                          @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(secondarySalesReportsService.getPartnerSummaries(parsedFrom, parsedTo, brand));
    }

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

    private String resolveStatus(String status) {
        return (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) ? null : status;
    }
}
