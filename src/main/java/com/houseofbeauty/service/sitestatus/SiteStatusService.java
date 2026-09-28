package com.houseofbeauty.service.sitestatus;

import com.houseofbeauty.service.common.OperationalStatusFilter;
import com.houseofbeauty.service.common.SiteSalesTypeFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class SiteStatusService {

    private final JdbcTemplate jdbcTemplate;

    public SiteStatusService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> getSiteCodes(String status, String salesType) {
        String sql = "SELECT Site_Code, MIN(Store_Name) AS Store_Name FROM site_master WHERE 1=1" +
                OperationalStatusFilter.whereClause(status) + SiteSalesTypeFilter.whereClause(salesType) +
                " GROUP BY Site_Code ORDER BY Site_Code";
        return new ArrayList<>(jdbcTemplate.queryForList(sql));
    }

    public List<String> getBrandsForSiteCode(String siteCode) {
        return jdbcTemplate.queryForList(
                "SELECT DISTINCT Brand FROM site_master WHERE Site_Code = ? ORDER BY Brand",
                String.class, siteCode);
    }

    public List<String> getAvailableStatuses() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM site_master", Integer.class);
        return (count == null || count == 0) ? List.of() : List.of("Active", "Inactive", "Upcoming");
    }

    public List<String> getAvailableSalesTypes() {
        String sql = "SELECT DISTINCT Sales_Type FROM site_master WHERE Sales_Type IS NOT NULL AND LTRIM(RTRIM(Sales_Type)) <> ''";
        java.util.TreeSet<String> types = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String type : jdbcTemplate.queryForList(sql, String.class)) {
            types.add(type.trim());
        }
        return new ArrayList<>(types);
    }

    public List<Map<String, Object>> getStoresByState(String state, String status) {
        String sql = "SELECT Site_Code, Brand, Store_Name, City, Region, State FROM site_master " +
                "WHERE State = ?" + OperationalStatusFilter.whereClause(status) + " ORDER BY Store_Name, Brand";
        return new ArrayList<>(jdbcTemplate.queryForList(sql, state));
    }
}
