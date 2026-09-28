package com.houseofbeauty.service.dashboard;

import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class DashboardGeoMapService {

    private final JdbcTemplate jdbcTemplate;

    public DashboardGeoMapService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> getSiteCities(String status) {
        String sql = "SELECT City, State, COUNT(*) AS site_count FROM site_master " +
                "WHERE City IS NOT NULL AND LTRIM(RTRIM(City)) <> ''" + OperationalStatusFilter.whereClause(status) +
                " GROUP BY City, State ORDER BY City";
        return new ArrayList<>(jdbcTemplate.queryForList(sql));
    }

    public List<Map<String, Object>> getSitesByCities(List<String> cities, String status) {
        if (cities == null || cities.isEmpty()) {
            return List.of();
        }
        String placeholders = cities.stream().map(c -> "?").collect(Collectors.joining(","));
        String sql = "SELECT Site_Code, Brand, Store_Name, City, Region FROM site_master " +
                "WHERE City IN (" + placeholders + ")" + OperationalStatusFilter.whereClause(status) +
                " ORDER BY Store_Name, Brand";
        return new ArrayList<>(jdbcTemplate.queryForList(sql, cities.toArray()));
    }
}
