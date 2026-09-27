package com.houseofbeauty.service.sitestatus;

import com.houseofbeauty.service.common.OperationalStatusFilter;
import com.houseofbeauty.service.common.SiteSalesTypeFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

// Backs the Site Status page's own Site Code dropdown card — every distinct real Site_Code
// site_master carries, for the user to pick from. A Site_Code can appear more than once in
// site_master (one row per Brand it stocks), so this is GROUP BY rather than a plain column read
// (also lets each Site_Code carry its own Store_Name for the picker's "code - name" display,
// MIN() is arbitrary — Store_Name doesn't vary across a Site_Code's own Brand rows in practice).
@Service
public class SiteStatusService {

    private final JdbcTemplate jdbcTemplate;

    public SiteStatusService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // status ("all"/"active"/"inactive"/"upcoming", the picker's own Status toggle pill — see
    // OperationalStatusFilter) narrows to Site_Codes with at least one matching Operational_Status
    // row; salesType ("all"/"primary"/"secondary", the picker's own Sales Type toggle pill — see
    // SiteSalesTypeFilter) narrows the same way against Sales_Type; null/"all" for either is every
    // real Site_Code, same as before either toggle existed.
    public List<Map<String, Object>> getSiteCodes(String status, String salesType) {
        String sql = "SELECT Site_Code, MIN(Store_Name) AS Store_Name FROM site_master WHERE 1=1" +
                OperationalStatusFilter.whereClause(status) + SiteSalesTypeFilter.whereClause(salesType) +
                " GROUP BY Site_Code ORDER BY Site_Code";
        return new ArrayList<>(jdbcTemplate.queryForList(sql));
    }

    // Site_Master's PK is (Site_Code, Brand), so one Site_Code can carry more than one Brand row —
    // the Site Status page's picker needs this to know whether to auto-pick the single brand or ask.
    public List<String> getBrandsForSiteCode(String siteCode) {
        return jdbcTemplate.queryForList(
                "SELECT DISTINCT Brand FROM site_master WHERE Site_Code = ? ORDER BY Brand",
                String.class, siteCode);
    }

    // Status pill options — backs the picker's own Status toggle pill (GET /api/site-status/statuses),
    // fetched the same "real Site_Master round-trip, not a hardcoded return" convention
    // DashboardOverviewService.getAvailableStatuses/PrimarySalesTodayService.getAvailableStatuses
    // already use, instead of the pill's All/Active/Inactive/Upcoming buttons being hardcoded straight
    // into SiteStatusPage.html. The category list itself (Active/Inactive/Upcoming) is the same fixed,
    // app-wide Site Status vocabulary OperationalStatusFilter classifies against — NOT derived from
    // Site_Master's own live distinct Operational_Status text (that column is free text with no
    // canonical enumeration to query). An empty/not-yet-imported Site_Master (count 0) or a genuine
    // DB-connectivity problem (query throws) both fall back to an empty list here, letting the frontend
    // show the same "Not Available" state Brand's own fetch failure already shows.
    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM site_master", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    // Sales Type pill options — backs the Site Code card's own Sales Type toggle pill
    // (GET /api/site-status/sales-types), real distinct site_master.Sales_Type values ("Primary
    // Sales"/"Secondary Sales" today) instead of the pill's All/Primary/Secondary buttons being
    // hardcoded straight into SiteStatusPage.html — same query DashboardOverviewService's own
    // getAvailableSalesTypes uses. Naturally falls back to an empty list (frontend shows "Not
    // Available") when site_master has no usable Sales_Type data yet, and a genuine DB-connectivity
    // problem surfaces as a thrown exception the same way.
    public List<String> getAvailableSalesTypes() {
        String sql = "SELECT DISTINCT Sales_Type FROM site_master WHERE Sales_Type IS NOT NULL AND LTRIM(RTRIM(Sales_Type)) <> ''";
        java.util.TreeSet<String> types = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String type : jdbcTemplate.queryForList(sql, String.class)) {
            types.add(type.trim());
        }
        return new ArrayList<>(types);
    }

    // Backs the Geo Map deep-link's own store-list card (SiteStatusPage.js) — every real site_master
    // row in the state the user picked on the map, so the page can show "stores in this state"
    // alongside the minimized map that led here. Scoped by the same Status toggle as the Site Code
    // picker/Geo Map itself (see getSiteCodes above), so this list never shows a store the rest of
    // the page's current filter has hidden.
    public List<Map<String, Object>> getStoresByState(String state, String status) {
        String sql = "SELECT Site_Code, Brand, Store_Name, City, Region, State FROM site_master " +
                "WHERE State = ?" + OperationalStatusFilter.whereClause(status) + " ORDER BY Store_Name, Brand";
        return new ArrayList<>(jdbcTemplate.queryForList(sql, state));
    }
}
