package com.houseofbeauty.service.teamperformance;

import com.houseofbeauty.service.common.OperationalStatusFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Component
public class TeamSiteRepository {

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
