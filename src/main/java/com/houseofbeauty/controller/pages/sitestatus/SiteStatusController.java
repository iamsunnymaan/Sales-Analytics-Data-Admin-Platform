package com.houseofbeauty.controller.pages.sitestatus;

import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.sitestatus.SiteStatusService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/site-status")
@RequirePermission("page:site-insights")
public class SiteStatusController {

    private final SiteStatusService siteStatusService;

    public SiteStatusController(SiteStatusService siteStatusService) {
        this.siteStatusService = siteStatusService;
    }

    @GetMapping("/site-codes")
    public ResponseEntity<List<Map<String, Object>>> getSiteCodes(@RequestParam(required = false) String status,
                                                                    @RequestParam(required = false) String salesType) {
        return ResponseEntity.ok(siteStatusService.getSiteCodes(status, salesType));
    }

    @GetMapping("/brands")
    public ResponseEntity<List<String>> getBrandsForSiteCode(@RequestParam String siteCode) {
        return ResponseEntity.ok(siteStatusService.getBrandsForSiteCode(siteCode));
    }

    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(siteStatusService.getAvailableStatuses());
    }

    @GetMapping("/sales-types")
    public ResponseEntity<List<String>> getAvailableSalesTypes() {
        return ResponseEntity.ok(siteStatusService.getAvailableSalesTypes());
    }

    @GetMapping("/stores-by-state")
    public ResponseEntity<List<Map<String, Object>>> getStoresByState(@RequestParam String state,
                                                                          @RequestParam(required = false) String status) {
        return ResponseEntity.ok(siteStatusService.getStoresByState(state, status));
    }
}
