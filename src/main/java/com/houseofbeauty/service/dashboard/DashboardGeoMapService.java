package com.houseofbeauty.service.dashboard;

import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

// Backs the Site Status page's Geo Map popup (GeoMap.js — moved there in full from the Dashboard
// page's former "4. Geo Map" section; kept in this package/under this name as an internal
// implementation detail, not tied to which page calls it) — every distinct (City, State) site_master
// carries, with a site-row count. GeoMap.js does the actual name-matching
// against its own bundled india-cities.json (normalize + alias + fuzzy match, since site_master's
// free-text City/State values don't line up 1:1 with census city names — real typos like "Bareily"/
// "Rourkel" live in this table, see that file's own header comment), then highlights the districts/
// cities that have real site coverage. site_master has no District column, so district coverage is
// derived transitively via each matched census city's own district field. getSitesByCities backs the
// click-through popup on a highlighted ("has-site") district: GeoMap.js already knows which real
// site_master City values matched into that district (built during the same matching pass), and
// passes them straight back here to list the actual sites.
@Service
public class DashboardGeoMapService {

    private final JdbcTemplate jdbcTemplate;

    public DashboardGeoMapService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // status ("all"/"active"/"inactive"/"upcoming", the Site Insight page's own Status toggle pill —
    // see OperationalStatusFilter) scopes this the same way it scopes the Site Code picker itself, so
    // the map's own coverage always matches whichever sites the rest of the page is currently showing.
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
