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

    @GetMapping("/comparison2/years")
    public ResponseEntity<List<Integer>> getComparison2Years() {
        return ResponseEntity.ok(primarySalesYearTrendService.listYears());
    }

    @GetMapping("/brands")
    public ResponseEntity<List<String>> getAvailableBrands() {
        return ResponseEntity.ok(primarySalesTodayService.getAvailableBrands());
    }

    @GetMapping("/channels")
    public ResponseEntity<List<String>> getAvailableChannels() {
        return ResponseEntity.ok(primarySalesTodayService.getAvailableChannels());
    }

    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(primarySalesTodayService.getAvailableStatuses());
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
        return ResponseEntity.ok(primarySalesDailyTrendService.getTrendRange(parsedFrom, parsedTo, granularity, brand, channel, resolveStatus(status)));
    }

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

    @GetMapping("/monthly")
    public ResponseEntity<MonthlySalesResponse> getMonthlySales(@RequestParam(defaultValue = "all") String brand,
                                                @RequestParam(required = false) String from,
                                                @RequestParam(required = false) String to,
                                                @RequestParam(defaultValue = "all") String channel,
                                                @RequestParam(defaultValue = "all") String status) {
        return ResponseEntity.ok(primarySalesTodayService.getMonthlySales(brand, parseDate(from), parseDate(to), channel, resolveStatus(status)));
    }

    @GetMapping("/monthly/breakdown")
    public ResponseEntity<List<MonthlyBreakdownEntry>> getMonthlyBreakdown(@RequestParam(defaultValue = "all") String brand,
                                                           @RequestParam(required = false) String asOf) {
        return ResponseEntity.ok(primarySalesTodayService.getMonthlyBreakdown(brand, parseDate(asOf)));
    }

    @GetMapping("/reports/brand-hierarchy")
    public ResponseEntity<List<Map<String, Object>>> getReportsBrandHierarchy(@RequestParam(required = false) String from,
                                                                                 @RequestParam(required = false) String to,
                                                                                 @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getBrandHierarchy(parsedFrom, parsedTo, brand));
    }

    @GetMapping("/reports/channels")
    public ResponseEntity<List<Map<String, Object>>> getReportsChannels(@RequestParam(required = false) String from,
                                                                          @RequestParam(required = false) String to,
                                                                          @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getChannelSummaries(parsedFrom, parsedTo, brand));
    }

    @GetMapping("/reports/subchannels")
    public ResponseEntity<List<Map<String, Object>>> getReportsSubChannels(@RequestParam(required = false) String from,
                                                                              @RequestParam(required = false) String to,
                                                                              @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getSubChannelSummaries(parsedFrom, parsedTo, brand));
    }

    @GetMapping("/reports/partners")
    public ResponseEntity<List<Map<String, Object>>> getReportsPartners(@RequestParam(required = false) String from,
                                                                           @RequestParam(required = false) String to,
                                                                           @RequestParam(defaultValue = "all") String brand) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(primarySalesReportsService.getPartnerSummaries(parsedFrom, parsedTo, brand));
    }

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

    private String resolveStatus(String status) {
        return (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) ? null : status;
    }
}
