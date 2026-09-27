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

// Backs the Site Status page (SiteStatusPage.js) — the Site Code dropdown card, plus the
// per-site-code Brand lookup it uses before embedding the Site Detail page.
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

    // Status toggle pill options — see SiteStatusService.getAvailableStatuses's own header comment.
    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(siteStatusService.getAvailableStatuses());
    }

    // Sales Type toggle pill options — see SiteStatusService.getAvailableSalesTypes's own header comment.
    @GetMapping("/sales-types")
    public ResponseEntity<List<String>> getAvailableSalesTypes() {
        return ResponseEntity.ok(siteStatusService.getAvailableSalesTypes());
    }

    // Backs the Geo Map deep-link's own store-list card — see wireGeoMapContextRow (SiteStatusPage.js).
    @GetMapping("/stores-by-state")
    public ResponseEntity<List<Map<String, Object>>> getStoresByState(@RequestParam String state,
                                                                          @RequestParam(required = false) String status) {
        return ResponseEntity.ok(siteStatusService.getStoresByState(state, status));
    }
}
