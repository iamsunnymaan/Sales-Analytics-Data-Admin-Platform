package com.houseofbeauty.controller.quickpanel;

import com.houseofbeauty.dto.topprojection.request.TopProjectionGridSaveRequest;
import com.houseofbeauty.dto.topprojection.response.TopProjectionEntryResponse;
import com.houseofbeauty.dto.topprojection.response.TopProjectionGridResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.topprojection.TopProjectionService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Backs the Quick Access Panel's "Projection Form" popup — per explicit request, its icon/popup are
// only shown on the Primary Sales page (see QuickAccessPanel.js's initQuickAccessPanel), since this
// data only ever feeds that page's Overview section. A manual-entry log whose current-month rows
// feed the Overview section's real "Projection" figure, see TopProjectionService's header comment. GET /grid
// loads every real Brand+Channel+Sub_Channel+Partner combo Site_Master has for the selected Brand/
// Channel toggles as one editable row each, POST /grid saves all of them in one Submit; GET /channels
// backs the Channel toggle's own options — see TopProjectionService#getGrid/#saveGrid/
// #getAvailableChannels for the full rationale. findExistingCurrentMonthEntry/submit/update live in
// the service, called internally by saveGrid per row.
@RestController
@RequestMapping("/api/top-projection")
@RequirePermission("page:primary-sales")
public class TopProjectionController {

    private final TopProjectionService topProjectionService;

    public TopProjectionController(TopProjectionService topProjectionService) {
        this.topProjectionService = topProjectionService;
    }

    // "View Projection Table" — every past submission, most recent first. Unused by the current
    // grid-based popup (same as before the redesign — see TopProjectionService's header comment);
    // left in place, not part of this redesign's scope.
    @GetMapping
    public List<TopProjectionEntryResponse> listEntries() {
        return topProjectionService.listEntries();
    }

    // The popup's grid table — every real Brand+Channel+Sub_Channel+Partner combo matching the
    // selected Brand ("all"/"ABH"/"Kylie"; omitted defaults to "all") and Channel ("all" or one of
    // GET /channels' own values; omitted defaults to "all") toggles, pre-filled with each combo's
    // existing submission where one exists.
    @GetMapping("/grid")
    public TopProjectionGridResponse getGrid(@RequestParam(required = false) String brand,
                                              @RequestParam(required = false) String channel) {
        return topProjectionService.getGrid(brand, channel);
    }

    // The popup's Channel toggle options ("All" plus this) — real Site_Master Channel values, not a
    // fixed list, so the toggle adapts if Site_Master's own Channel vocabulary ever changes.
    @GetMapping("/channels")
    public List<String> getChannels() {
        return topProjectionService.getAvailableChannels();
    }

    // The popup's Sale Type pill options ("All" plus this) — real Site_Master Sales_Type values.
    // Purely informational/locked to "Primary Sales" on the frontend (this whole feature is
    // permanently scoped server-side to Sales_Type = 'Primary Sales', see getGrid/getAvailableChannels
    // above), not an actual selectable filter — no corresponding request param on GET /grid.
    @GetMapping("/sale-types")
    public List<String> getSaleTypes() {
        return topProjectionService.getAvailableSaleTypes();
    }

    // Bulk Save — every row the popup's grid currently shows, submitted together.
    @PostMapping("/grid")
    public List<TopProjectionEntryResponse> saveGrid(@RequestBody TopProjectionGridSaveRequest request) {
        return topProjectionService.saveGrid(request == null ? null : request.rows());
    }
}
