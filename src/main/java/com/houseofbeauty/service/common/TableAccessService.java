package com.houseofbeauty.service.common;

import com.houseofbeauty.util.SqlDialect;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class TableAccessService {


    private static final Set<String> NOT_COMPARABLE_TYPES =
            Set.of("text", "ntext", "image", "varbinary", "xml");


    private static final Set<String> NUMERIC_TYPES = Set.of(
            "decimal", "numeric", "float", "real", "int", "bigint", "smallint", "tinyint", "money", "smallmoney");


    private static final int MAX_QUERY_PARAMS = 1800;


    private static final Set<String> VISIBLE_TABLES = Set.of(
            "Primary_Sales_Target", "Product_Master", "Batch_Master", "Primary_Sales", "site_master",
            "Secondary_Sales", "Secondary_Sales_Target");

    private final JdbcTemplate jdbcTemplate;
    private final SqlDialect dialect;
    private final String upsertRowOrderSql;
    private final String upsertLastImportSql;


    private volatile Boolean tableRowOrderExists;


    public static final char ROW_ORDER_KEY_DELIMITER = (char) 31;

    public TableAccessService(JdbcTemplate jdbcTemplate, SqlDialect dialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.dialect = dialect;
        this.upsertRowOrderSql = "INSERT INTO table_row_order (table_key, pk_value, seq) VALUES (?, ?, ?) " +
                "ON DUPLICATE KEY UPDATE seq = VALUES(seq)";
        this.upsertLastImportSql = "INSERT INTO table_last_import (table_key, last_committed_at) VALUES (?, ?) " +
                "ON DUPLICATE KEY UPDATE last_committed_at = VALUES(last_committed_at)";
    }

    private static boolean isVisibleTable(String tableName) {
        return VISIBLE_TABLES.stream().anyMatch(visible -> visible.equalsIgnoreCase(tableName));
    }


    private String quote(String identifier) {
        return dialect.quote(identifier);
    }

    public boolean tableRowOrderExists() {
        Boolean cached = tableRowOrderExists;
        if (cached != null) {
            return cached;
        }
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = " + dialect.currentSchemaFn() +
                        " AND TABLE_NAME = 'table_row_order'",
                Integer.class);
        boolean exists = count != null && count > 0;
        tableRowOrderExists = exists;
        return exists;
    }


    public long countRows(String table) {
        Long count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + quote(table), Long.class);
        return count == null ? 0 : count;
    }

    public List<String> listAvailableTables() {
        List<String> tables = jdbcTemplate.queryForList(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = " + dialect.currentSchemaFn() +
                        " AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
                String.class);
        return tables.stream().filter(TableAccessService::isVisibleTable).toList();
    }

    public String validateTable(String tableName) {

        boolean exists = listAvailableTables().stream().anyMatch(t -> t.equalsIgnoreCase(tableName));
        if (!isVisibleTable(tableName) || !exists) {
            throw new IllegalArgumentException("Unknown table: " + tableName);
        }
        return tableName;
    }

    public Map<String, String> getColumnTypes(String tableName) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = " + dialect.currentSchemaFn() +
                        " AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                tableName);

        Map<String, String> types = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            types.put((String) row.get("COLUMN_NAME"), ((String) row.get("DATA_TYPE")).toLowerCase());
        }
        return types;
    }


    public Set<String> getNullableColumns(String tableName) {
        List<String> columns = jdbcTemplate.queryForList(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = " + dialect.currentSchemaFn() +
                        " AND TABLE_NAME = ? AND IS_NULLABLE = 'YES'",
                new Object[]{tableName},
                String.class);
        return new LinkedHashSet<>(columns);
    }

    public List<String> getPrimaryKeyColumns(String tableName) {
        return jdbcTemplate.queryForList(
                "SELECT c.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE c " +
                        "JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS t " +
                        "  ON c.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA " +
                        "WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY' AND c.TABLE_SCHEMA = " + dialect.currentSchemaFn() +
                        " AND c.TABLE_NAME = ? " +
                        "ORDER BY c.ORDINAL_POSITION",
                new Object[]{tableName},
                String.class);
    }

    
    public List<String> getForeignKeyLocalColumns(String constraintName) {
        return jdbcTemplate.queryForList(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE " +
                        "WHERE TABLE_SCHEMA = " + dialect.currentSchemaFn() + " AND CONSTRAINT_NAME = ? ORDER BY ORDINAL_POSITION",
                new Object[]{constraintName},
                String.class);
    }

    
    public record ForeignKeyRef(String constraintName, List<String> localColumns, String referencedTable,
                                 List<String> referencedColumns) {
    }

    
    public List<ForeignKeyRef> getForeignKeyReferences(String tableName) {
        String sql = "SELECT CONSTRAINT_NAME AS constraint_name, COLUMN_NAME AS local_column, " +
                        "  REFERENCED_TABLE_NAME AS referenced_table, REFERENCED_COLUMN_NAME AS referenced_column " +
                        "FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL " +
                        "ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION";
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, new Object[]{tableName});

        Map<String, List<String>> localColumnsByConstraint = new LinkedHashMap<>();
        Map<String, List<String>> referencedColumnsByConstraint = new LinkedHashMap<>();
        Map<String, String> referencedTableByConstraint = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            String constraintName = (String) row.get("constraint_name");
            localColumnsByConstraint.computeIfAbsent(constraintName, k -> new ArrayList<>())
                    .add((String) row.get("local_column"));
            referencedColumnsByConstraint.computeIfAbsent(constraintName, k -> new ArrayList<>())
                    .add((String) row.get("referenced_column"));
            referencedTableByConstraint.putIfAbsent(constraintName, (String) row.get("referenced_table"));
        }

        List<ForeignKeyRef> result = new ArrayList<>();
        for (String constraintName : localColumnsByConstraint.keySet()) {
            result.add(new ForeignKeyRef(constraintName, localColumnsByConstraint.get(constraintName),
                    referencedTableByConstraint.get(constraintName), referencedColumnsByConstraint.get(constraintName)));
        }
        return result;
    }

    
    public Set<String> getIdentityColumns(String tableName) {

        String sql = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA = 'auto_increment'";
        List<String> columns = jdbcTemplate.queryForList(sql, new Object[]{tableName}, String.class);
        return new LinkedHashSet<>(columns);
    }

    
    public Set<String> getComputedColumns(String tableName) {

        String sql = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA LIKE '%GENERATED%'";
        List<String> columns = jdbcTemplate.queryForList(sql, new Object[]{tableName}, String.class);
        return new LinkedHashSet<>(columns);
    }


    public long getNextNumericColumnValue(String table, String column) {
        Long max = jdbcTemplate.queryForObject(
                "SELECT MAX(" + quote(column) + ") FROM " + quote(table), Long.class);
        return (max == null ? 0L : max) + 1;
    }

    
    public void setIdentityInsert(String table, boolean on) {
        jdbcTemplate.execute(dialect.identityInsertToggle(table, on));
    }

    public int applyUpdate(String table, Map<String, Object> keys, Map<String, Object> values) {
        StringBuilder sql = new StringBuilder("UPDATE ").append(quote(table)).append(" SET ");
        List<Object> params = new ArrayList<>();
        appendSetClause(sql, params, values);

        sql.append(" WHERE ");
        appendWhereClause(sql, params, keys);

        return jdbcTemplate.update(sql.toString(), params.toArray());
    }

    
    public int countFullMatch(String table, Map<String, Object> row) {
        Map<String, Object> matchable = comparableColumns(table, row);
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM ").append(quote(table)).append(" WHERE ");
        List<Object> params = new ArrayList<>();
        appendWhereClause(sql, params, matchable);

        Integer count = jdbcTemplate.queryForObject(sql.toString(), params.toArray(), Integer.class);
        return count == null ? 0 : count;
    }

    public int applyUpdateByFullMatch(String table, Map<String, Object> originalRow, Map<String, Object> values) {
        StringBuilder sql = new StringBuilder("UPDATE ").append(quote(table)).append(" SET ");
        List<Object> params = new ArrayList<>();
        appendSetClause(sql, params, values);

        sql.append(" WHERE ");
        appendWhereClause(sql, params, comparableColumns(table, originalRow));

        return jdbcTemplate.update(sql.toString(), params.toArray());
    }

    
    public int applyDelete(String table, Map<String, Object> matchColumns) {
        StringBuilder sql = new StringBuilder("DELETE FROM ").append(quote(table)).append(" WHERE ");
        List<Object> params = new ArrayList<>();
        appendWhereClause(sql, params, comparableColumns(table, matchColumns));

        return jdbcTemplate.update(sql.toString(), params.toArray());
    }


    public void truncateTable(String table) {
        try {
            jdbcTemplate.execute("TRUNCATE TABLE " + quote(table));
        } catch (DataAccessException e) {
            String message = e.getMostSpecificCause().getMessage();
            if (message != null && message.toLowerCase().contains("foreign key")) {
                jdbcTemplate.execute("DELETE FROM " + quote(table));
            } else {
                throw e;
            }
        }
        clearRowOrder(table);
    }

    
    public void recordRowOrder(String table, Map<String, Long> pkValueToSeq) {
        if (pkValueToSeq.isEmpty() || !tableRowOrderExists()) {
            return;
        }
        List<Object[]> batchArgs = pkValueToSeq.entrySet().stream()
                .map(e -> new Object[]{table, e.getKey(), e.getValue()})
                .toList();
        jdbcTemplate.batchUpdate(upsertRowOrderSql, batchArgs);
    }


    private void clearRowOrder(String table) {
        if (!tableRowOrderExists()) {
            return;
        }
        jdbcTemplate.update("DELETE FROM table_row_order WHERE table_key = ?", table);
    }


    private volatile Boolean tableLastImportExists;

    public boolean tableLastImportExists() {
        Boolean cached = tableLastImportExists;
        if (cached != null) {
            return cached;
        }
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = " + dialect.currentSchemaFn() +
                        " AND TABLE_NAME = 'table_last_import'",
                Integer.class);
        boolean exists = count != null && count > 0;
        tableLastImportExists = exists;
        return exists;
    }


    public void recordLastImport(String table) {
        if (!tableLastImportExists()) {
            return;
        }
        jdbcTemplate.update(upsertLastImportSql, table, LocalDateTime.now());
    }


    public LocalDateTime getLastImportedAt(String table) {
        if (!tableLastImportExists()) {
            return null;
        }
        List<LocalDateTime> rows = jdbcTemplate.query(
                "SELECT last_committed_at FROM table_last_import WHERE table_key = ?",
                (rs, rowNum) -> rs.getTimestamp("last_committed_at").toLocalDateTime(), table);
        return rows.isEmpty() ? null : rows.get(0);
    }


    public int rescaleNumericColumn(String table, String column, double factor) {
        String type = getColumnTypes(table).get(column);
        if (type == null) {
            throw new IllegalArgumentException("Unknown column: " + column);
        }
        if (!NUMERIC_TYPES.contains(type)) {
            throw new IllegalArgumentException("Column '" + column + "' is not numeric (type: " + type + ").");
        }
        return jdbcTemplate.update(
                "UPDATE " + quote(table) + " SET " + quote(column) + " = " + quote(column) + " * ?", factor);
    }

    private Map<String, Object> comparableColumns(String table, Map<String, Object> row) {
        Map<String, String> columnTypes = getColumnTypes(table);
        Map<String, Object> filtered = new LinkedHashMap<>();
        row.forEach((column, value) -> {
            if (!NOT_COMPARABLE_TYPES.contains(columnTypes.get(column))) {
                filtered.put(column, value);
            }
        });
        if (filtered.isEmpty()) {
            throw new IllegalStateException(
                    "This table has no columns that can be used to match a row (the rest are text/blob).");
        }
        return filtered;
    }

    public int applyInsert(String table, Map<String, Object> row) {
        List<String> columns = new ArrayList<>(row.keySet());
        StringBuilder sql = new StringBuilder("INSERT INTO ").append(quote(table)).append(" (")
                .append(columns.stream().map(this::quote).collect(Collectors.joining(", ")))
                .append(") VALUES (")
                .append(columns.stream().map(c -> "?").collect(Collectors.joining(", ")))
                .append(")");
        List<Object> params = columns.stream().map(row::get).collect(Collectors.toList());

        return jdbcTemplate.update(sql.toString(), params.toArray());
    }

    
    public void applyInsertBatch(String table, List<String> columns, List<Map<String, Object>> rows) {
        String sql = "INSERT INTO " + quote(table) + " (" +
                columns.stream().map(this::quote).collect(Collectors.joining(", ")) +
                ") VALUES (" +
                columns.stream().map(c -> "?").collect(Collectors.joining(", ")) +
                ")";

        jdbcTemplate.batchUpdate(sql, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                Map<String, Object> row = rows.get(i);
                int paramIndex = 1;
                for (String column : columns) {
                    ps.setObject(paramIndex++, row.get(column));
                }
            }

            @Override
            public int getBatchSize() {
                return rows.size();
            }
        });
    }

    
    public Set<Integer> findExistingRowIndexes(String table, List<Map<String, Object>> keyMaps) {
        if (keyMaps.isEmpty()) {
            return Set.of();
        }


        Map<String, List<Integer>> indexesByTuple = new LinkedHashMap<>();
        Map<String, Map<String, Object>> tupleValues = new LinkedHashMap<>();
        for (int i = 0; i < keyMaps.size(); i++) {
            Map<String, Object> keyMap = keyMaps.get(i);
            String tuple = keyMap.entrySet().stream()
                    .map(e -> e.getKey() + "=" + e.getValue())
                    .collect(Collectors.joining("|"));
            indexesByTuple.computeIfAbsent(tuple, t -> new ArrayList<>()).add(i);
            tupleValues.putIfAbsent(tuple, keyMap);
        }


        List<String> tuples = new ArrayList<>(tupleValues.keySet());
        Set<String> matchedTuples = new HashSet<>();
        int start = 0;
        while (start < tuples.size()) {
            int end = start;
            int paramBudget = 0;
            while (end < tuples.size()) {
                long nonNullValues = tupleValues.get(tuples.get(end)).values().stream()
                        .filter(v -> v != null).count();
                int tupleParamCount = 2 * (int) nonNullValues;
                if (end > start && paramBudget + tupleParamCount > MAX_QUERY_PARAMS) {
                    break;
                }
                paramBudget += tupleParamCount;
                end++;
            }
            matchedTuples.addAll(findExistingTuplesBatch(table, tuples.subList(start, end), tupleValues));
            start = end;
        }

        Set<Integer> existingRowIndexes = new HashSet<>();
        for (String tuple : matchedTuples) {
            existingRowIndexes.addAll(indexesByTuple.get(tuple));
        }
        return existingRowIndexes;
    }

    private Set<String> findExistingTuplesBatch(String table, List<String> tupleBatch,
                                                  Map<String, Map<String, Object>> tupleValues) {
        StringBuilder sql = new StringBuilder("SELECT DISTINCT CASE ");
        List<Object> caseParams = new ArrayList<>();
        StringBuilder whereClause = new StringBuilder();
        List<Object> whereParams = new ArrayList<>();

        for (int i = 0; i < tupleBatch.size(); i++) {
            Map<String, Object> keyMap = tupleValues.get(tupleBatch.get(i));

            sql.append("WHEN (");
            appendWhereClause(sql, caseParams, keyMap);
            sql.append(") THEN ").append(i).append(' ');

            if (i > 0) {
                whereClause.append(" OR ");
            }
            whereClause.append('(');
            appendWhereClause(whereClause, whereParams, keyMap);
            whereClause.append(')');
        }
        sql.append("END AS tuple_index FROM ").append(quote(table)).append(" WHERE ").append(whereClause);

        List<Object> allParams = new ArrayList<>(caseParams);
        allParams.addAll(whereParams);

        List<Integer> matchedLocalIndexes = jdbcTemplate.queryForList(sql.toString(), allParams.toArray(), Integer.class);

        Set<String> matched = new HashSet<>();
        for (Integer localIndex : matchedLocalIndexes) {
            matched.add(tupleBatch.get(localIndex));
        }
        return matched;
    }

    private void appendSetClause(StringBuilder sql, List<Object> params, Map<String, Object> values) {
        List<String> setColumns = new ArrayList<>(values.keySet());
        for (int i = 0; i < setColumns.size(); i++) {
            if (i > 0) {
                sql.append(", ");
            }
            sql.append(quote(setColumns.get(i))).append(" = ?");
            params.add(values.get(setColumns.get(i)));
        }
    }

    private void appendWhereClause(StringBuilder sql, List<Object> params, Map<String, Object> matchColumns) {
        List<String> columns = new ArrayList<>(matchColumns.keySet());
        for (int i = 0; i < columns.size(); i++) {
            if (i > 0) {
                sql.append(" AND ");
            }
            Object value = matchColumns.get(columns.get(i));
            sql.append(quote(columns.get(i)));
            if (value == null) {
                sql.append(" IS NULL");
            } else {
                sql.append(" = ?");
                params.add(value);
            }
        }
    }
}
