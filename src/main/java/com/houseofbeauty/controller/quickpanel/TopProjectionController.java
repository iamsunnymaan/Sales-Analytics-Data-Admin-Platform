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

@RestController
@RequestMapping("/api/top-projection")
@RequirePermission("page:primary-sales")
public class TopProjectionController {

    private final TopProjectionService topProjectionService;

    public TopProjectionController(TopProjectionService topProjectionService) {
        this.topProjectionService = topProjectionService;
    }

    @GetMapping
    public List<TopProjectionEntryResponse> listEntries() {
        return topProjectionService.listEntries();
    }

    @GetMapping("/grid")
    public TopProjectionGridResponse getGrid(@RequestParam(required = false) String brand,
                                              @RequestParam(required = false) String channel) {
        return topProjectionService.getGrid(brand, channel);
    }

    @GetMapping("/channels")
    public List<String> getChannels() {
        return topProjectionService.getAvailableChannels();
    }

    @GetMapping("/sale-types")
    public List<String> getSaleTypes() {
        return topProjectionService.getAvailableSaleTypes();
    }

    @PostMapping("/grid")
    public List<TopProjectionEntryResponse> saveGrid(@RequestBody TopProjectionGridSaveRequest request) {
        return topProjectionService.saveGrid(request == null ? null : request.rows());
    }
}
