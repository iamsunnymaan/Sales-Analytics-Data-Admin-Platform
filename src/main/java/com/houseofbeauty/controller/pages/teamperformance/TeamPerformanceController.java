package com.houseofbeauty.controller.pages.teamperformance;

import com.houseofbeauty.dto.teamperformance.response.PersonFyOverviewResponse;
import com.houseofbeauty.dto.teamperformance.response.PersonSitesResponse;
import com.houseofbeauty.dto.teamperformance.response.TrendRangeResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.teamperformance.TeamPerformanceReportService;
import com.houseofbeauty.service.teamperformance.TeamPersonService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/team-performance")
@RequirePermission("page:team-insights")
public class TeamPerformanceController {

    private final TeamPerformanceReportService teamPerformanceReportService;
    private final TeamPersonService teamPersonService;

    public TeamPerformanceController(TeamPerformanceReportService teamPerformanceReportService,
                                      TeamPersonService teamPersonService) {
        this.teamPerformanceReportService = teamPerformanceReportService;
        this.teamPersonService = teamPersonService;
    }

    private static LocalDate parseDate(String date) {
        return (date == null || date.isBlank()) ? null : LocalDate.parse(date);
    }

    @GetMapping("/statuses")
    public ResponseEntity<List<String>> getAvailableStatuses() {
        return ResponseEntity.ok(teamPerformanceReportService.getAvailableStatuses());
    }

    @GetMapping("/sales-types")
    public ResponseEntity<List<String>> getAvailableSalesTypes() {
        return ResponseEntity.ok(teamPerformanceReportService.getAvailableSalesTypes());
    }

    @GetMapping("/reports/hierarchy")
    public ResponseEntity<List<Map<String, Object>>> getPositionHierarchy(@RequestParam(required = false) String from,
                                                                            @RequestParam(required = false) String to,
                                                                            @RequestParam(required = false, defaultValue = "secondary") String salesType,
                                                                            @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPerformanceReportService.getPositionHierarchy(parseDate(from), parseDate(to), salesType, status));
    }

    @GetMapping("/reports/am")
    public ResponseEntity<List<Map<String, Object>>> getAmSummaries(@RequestParam(required = false) String from,
                                                                      @RequestParam(required = false) String to,
                                                                      @RequestParam(required = false, defaultValue = "secondary") String salesType,
                                                                      @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPerformanceReportService.getAmSummaries(parseDate(from), parseDate(to), salesType, status));
    }

    @GetMapping("/reports/cm")
    public ResponseEntity<List<Map<String, Object>>> getCmSummaries(@RequestParam(required = false) String from,
                                                                      @RequestParam(required = false) String to,
                                                                      @RequestParam(required = false, defaultValue = "secondary") String salesType,
                                                                      @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPerformanceReportService.getCmSummaries(parseDate(from), parseDate(to), salesType, status));
    }

    @GetMapping("/reports/sm")
    public ResponseEntity<List<Map<String, Object>>> getSmSummaries(@RequestParam(required = false) String from,
                                                                      @RequestParam(required = false) String to,
                                                                      @RequestParam(required = false, defaultValue = "secondary") String salesType,
                                                                      @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPerformanceReportService.getSmSummaries(parseDate(from), parseDate(to), salesType, status));
    }

    @GetMapping("/person/sites")
    public ResponseEntity<PersonSitesResponse> getPersonSites(@RequestParam String level, @RequestParam String name,
                                                                @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPersonService.getPersonSites(level, name, status));
    }

    @GetMapping("/reports/site-master")
    public ResponseEntity<List<Map<String, Object>>> getSiteMasterReport(@RequestParam String level,
                                                                            @RequestParam String name,
                                                                            @RequestParam(required = false) String from,
                                                                            @RequestParam(required = false) String to,
                                                                            @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPerformanceReportService.getSiteMasterReport(parseDate(from), parseDate(to), level, name, status));
    }

    @GetMapping("/person/fy-overview")
    public ResponseEntity<PersonFyOverviewResponse> getPersonFyOverview(@RequestParam String level,
                                                                          @RequestParam String name,
                                                                          @RequestParam String fyKey,
                                                                          @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPersonService.getPersonFyOverview(level, name, fyKey, status));
    }

    @GetMapping("/person/trend-range")
    public ResponseEntity<TrendRangeResponse> getPersonTrendRange(@RequestParam String level,
                                                                    @RequestParam String name,
                                                                    @RequestParam(required = false) String from,
                                                                    @RequestParam(required = false) String to,
                                                                    @RequestParam(required = false) String granularity,
                                                                    @RequestParam(required = false, defaultValue = "active") String status) {
        return ResponseEntity.ok(teamPersonService.getPersonTrendRange(level, name, parseDate(from), parseDate(to), granularity, status));
    }
}
