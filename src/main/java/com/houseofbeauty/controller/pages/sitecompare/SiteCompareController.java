package com.houseofbeauty.controller.pages.sitecompare;

import com.houseofbeauty.dto.sitecompare.SitePairDto;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.sitecompare.SiteCompareService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/site-compare")
@RequirePermission("page:site-insights")
public class SiteCompareController {

    private final SiteCompareService siteCompareService;

    public SiteCompareController(SiteCompareService siteCompareService) {
        this.siteCompareService = siteCompareService;
    }

    @GetMapping("/states")
    public ResponseEntity<List<Map<String, Object>>> compareStates(@RequestParam(required = false) String status) {
        return ResponseEntity.ok(siteCompareService.compareStates(status));
    }

    @GetMapping("/states-list")
    public ResponseEntity<List<String>> getDistinctStates() {
        return ResponseEntity.ok(siteCompareService.getDistinctStates());
    }

    @GetMapping("/sites-in-state")
    public ResponseEntity<List<Map<String, Object>>> compareSitesInState(@RequestParam String state,
                                                                            @RequestParam(required = false) String status) {
        return ResponseEntity.ok(siteCompareService.compareSitesInState(state, status));
    }

    @GetMapping("/stores-picker")
    public ResponseEntity<List<Map<String, Object>>> getAllStoresForPicker(@RequestParam(required = false) String status) {
        return ResponseEntity.ok(siteCompareService.getAllStoresForPicker(status));
    }

    @PostMapping("/stores")
    public ResponseEntity<List<Map<String, Object>>> compareSelectedStores(@RequestBody List<SitePairDto> sites) {
        return ResponseEntity.ok(siteCompareService.compareSelectedStores(sites));
    }
}
