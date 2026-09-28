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

    @GetMapping("/trend-range")
    public ResponseEntity<TrendRangeResponse> getTrendRange(@RequestParam String siteCode, @RequestParam String brand,
                                                              @RequestParam(required = false) String from,
                                                              @RequestParam(required = false) String to,
                                                              @RequestParam(defaultValue = "day") String granularity) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(siteDetailTrendService.getTrendRange(siteCode, brand, parsedFrom, parsedTo, granularity));
    }

    @GetMapping("/trend-years")
    public ResponseEntity<List<Integer>> getTrendYears(@RequestParam String siteCode, @RequestParam String brand) {
        return ResponseEntity.ok(siteDetailTrendService.getYearsWithData(siteCode, brand));
    }

    @GetMapping("/product-level")
    public ResponseEntity<ProductLevelResponse> getProductLevel(@RequestParam String siteCode, @RequestParam String brand,
                                                                   @RequestParam(required = false) String from,
                                                                   @RequestParam(required = false) String to) {
        LocalDate parsedFrom = (from == null || from.isBlank()) ? null : LocalDate.parse(from);
        LocalDate parsedTo = (to == null || to.isBlank()) ? null : LocalDate.parse(to);
        return ResponseEntity.ok(siteDetailProductLevelService.getProductLevel(siteCode, brand, parsedFrom, parsedTo));
    }

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
