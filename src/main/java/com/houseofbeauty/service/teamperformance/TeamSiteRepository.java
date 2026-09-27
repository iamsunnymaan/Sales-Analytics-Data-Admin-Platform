package com.houseofbeauty.service.teamperformance;

import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// Shared site_master reader for every Team Insights backend piece (TeamPerformanceReportService's
// own RM->AM->CM->SM report, TeamPersonService's per-person drill-down) — one real (Site_Code,
// Brand) row per site. `status` ("all"/"active"/"inactive"/"upcoming") wires in the Filter Header's
// own Status toggle pill (TeamPerformancePage.html's #teamPerformanceStatusFilterToggle), per
// explicit request — same Site Insight page's own Status toggle + OperationalStatusFilter
// keyword-matching convention (SiteStatusPage.html/.js), defaulting to "active" (this page's own
// previous hardcoded-Active-only behavior) so a client that omits the param entirely still gets
// today's numbers.
@Component
public class TeamSiteRepository {

    // Maps the "rm"/"am"/"cm"/"sm" level query param (as received from the frontend) to its real
    // site_master column name — an explicit whitelist, not a pass-through: the value is
    // concatenated directly into SQL below since JdbcTemplate has no placeholder syntax for
    // column names, so an unvalidated value here would be a SQL injection hole.
    public static final Map<String, String> LEVEL_COLUMNS = Map.of(
            "rm", "RM", "am", "AM", "cm", "CM", "sm", "SM");

    private final JdbcTemplate jdbcTemplate;

    public TeamSiteRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public static String requireLevelColumn(String level) {
        String column = level == null ? null : LEVEL_COLUMNS.get(level.toLowerCase(Locale.ROOT));
        if (column == null) {
            throw new IllegalArgumentException("Invalid level: must be one of " + LEVEL_COLUMNS.keySet());
        }
        return column;
    }

    // "Primary Sales"/"Secondary Sales"/"ALL" (case-insensitive) -> the real Sales_Type column
    // value to filter on, or null for no filter (both types). Same literal values
    // Primary/SecondarySalesReportsService already filter on.
    public static String resolveSalesTypeFilter(String salesType) {
        if (salesType == null || salesType.isBlank() || "all".equalsIgnoreCase(salesType)) {
            return null;
        }
        if ("primary".equalsIgnoreCase(salesType)) {
            return "Primary Sales";
        }
        if ("secondary".equalsIgnoreCase(salesType)) {
            return "Secondary Sales";
        }
        throw new IllegalArgumentException("Invalid salesType: must be one of all, primary, secondary");
    }

    private static String orUncategorized(String value) {
        return value == null || value.isBlank() ? "Uncategorized" : value;
    }

    // `salesType` (already-resolved "Primary Sales"/"Secondary Sales"/null for both), `status`
    // ("all"/"active"/"inactive"/"upcoming"/null, via OperationalStatusFilter), and `levelColumn`+
    // `name` (a real site_master column from LEVEL_COLUMNS + the exact value to match, or null/null
    // for every site) are all optional filters, composed freely by callers.
    public List<TeamSiteRow> loadSiteRows(String salesType, String status, String levelColumn, String name) {
        StringBuilder sql = new StringBuilder(
                "SELECT Site_Code, Brand, Store_Name, Sales_Type, Channel, Partner, RM, AM, CM, SM " +
                        "FROM site_master WHERE 1 = 1" + OperationalStatusFilter.whereClause(status));
        List<Object> params = new ArrayList<>();
        if (salesType != null) {
            sql.append(" AND Sales_Type = ?");
            params.add(salesType);
        }
        if (levelColumn != null) {
            sql.append(" AND ").append(levelColumn).append(" = ?");
            params.add(name);
        }
        List<TeamSiteRow> rows = new ArrayList<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            rows.add(new TeamSiteRow(
                    (String) row.get("Site_Code"),
                    (String) row.get("Brand"),
                    orUncategorized((String) row.get("Store_Name")),
                    (String) row.get("Sales_Type"),
                    (String) row.get("Channel"),
                    (String) row.get("Partner"),
                    orUncategorized((String) row.get("RM")),
                    orUncategorized((String) row.get("AM")),
                    orUncategorized((String) row.get("CM")),
                    orUncategorized((String) row.get("SM"))));
        }
        return rows;
    }
}
