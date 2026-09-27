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

    // MySQL may reject "=" (and other comparison operators) against these types outright — they
    // can only be matched with LOB-specific functions, so they're dropped from WHERE clauses.
    private static final Set<String> NOT_COMPARABLE_TYPES =
            Set.of("text", "ntext", "image", "varbinary", "xml");

    // Used by rescaleNumericColumn to reject a non-numeric column before it ever reaches the database
    // as an arithmetic operand.
    private static final Set<String> NUMERIC_TYPES = Set.of(
            "decimal", "numeric", "float", "real", "int", "bigint", "smallint", "tinyint", "money", "smallmoney");

    // Caps a single query's placeholder count well under MySQL's prepared-statement limit
    // (2,100) so a batch built from tuples with several key columns each still has headroom (see
    // findExistingRowIndexes).
    private static final int MAX_QUERY_PARAMS = 1800;

    // Per explicit request 2026-08-25: an INCLUDE-list, not an exclude-list — ONLY these five tables
    // are ever exposed anywhere in the app (Explorer, Upload, any generic table endpoint). Everything
    // else in the database (Stock, the app's own internal tracking tables like import_sessions/
    // table_row_order, any legacy/orphaned table left over from an old schema) stays completely
    // inaccessible through this service, with no need to keep a growing exclude-list in sync every
    // time a new non-data table gets added to the database. Matched case-insensitively (see
    // isVisibleTable) since INFORMATION_SCHEMA's own casing for a table isn't guaranteed to match
    // what's written here.
    private static final Set<String> VISIBLE_TABLES = Set.of(
            "Primary_Sales_Target", "Product_Master", "Batch_Master", "Primary_Sales", "site_master",
            "Secondary_Sales", "Secondary_Sales_Target");

    private final JdbcTemplate jdbcTemplate;
    private final SqlDialect dialect;
    private final String upsertRowOrderSql;
    private final String upsertLastImportSql;

    // table_row_order (declared in database/01_schema.sql, written by recordRowOrder/clearRowOrder
    // below and read by TableDataController's buildFromAndOrderBy) may not exist in every environment
    // this app is pointed at — every touch point below checks this first and no-ops/falls back
    // gracefully instead of throwing, the same graceful-when-missing philosophy the rest of this app
    // already applies to absent data. Cached after the first check (a schema either has this table
    // for the life of the JVM or it doesn't; this class has no mechanism to create it, so there's
    // nothing to invalidate the cache for).
    private volatile Boolean tableRowOrderExists;

    // Delimiter used to concatenate composite-PK column values into a single table_row_order.pk_value
    // string (see ImportAtomicCommitRunner.recordRowOrder, which builds it, and
    // TableDataController.buildFromAndOrderBy, which must build the exact same concatenation on the
    // read side — CHAR(31)). Code point 31 (Unit Separator) is a non-printable control
    // character that never legitimately appears in uploaded business data (Site_Code, Brand, etc.),
    // so it can't collide with a real column value the way a printable separator like "|" could.
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

    // Wraps an identifier in the active dialect's quoting (`table`/`column`) — used everywhere a table/column name is interpolated into a SQL
    // string (always pre-validated against a real INFORMATION_SCHEMA lookup before reaching here,
    // never raw user input).
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

    // Section 01 "Available Tables" card's row count. `table` must already be validated (see
    // validateTable) before reaching here — this interpolates it directly into the SQL like
    // truncateTable/applyInsert already do elsewhere in this class.
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
        // Matched case-insensitively — INFORMATION_SCHEMA's own casing for a table isn't guaranteed
        // to match what VISIBLE_TABLES/the frontend/the Java entities use. The canonical tableName is
        // still what's returned and used everywhere downstream, since a bracket-quoted identifier
        // resolves case-insensitively against the real table under MySQL's default
        // case-insensitive collation regardless.
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

    // CHANGED 2026-08-11: added for ImportSessionController.validateColumns() — a NULLable column
    // (e.g. Product_Master.Uploaded_At, Site_Master.Brand) has no business being "required" in an
    // uploaded file's header row just because it isn't identity/computed/app-managed-PK; a file that
    // simply doesn't track that optional field should upload fine, landing those cells as real SQL
    // NULL. Only genuinely NOT NULL columns should ever be "missing" errors.
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

    /**
     * Resolves a named FOREIGN KEY constraint back to the LOCAL (child-table) column(s) it's
     * declared on — e.g. for {@code FK_PrimarySales_Billto_SiteMaster FOREIGN KEY (Bill_to)
     * REFERENCES Site_Master (Site_Code)}, returns {@code ["Bill_to"]}, NOT {@code "Site_Code"}.
     * Needed because the database's own FK-violation error text names the REFERENCED table/column,
     * which is a different table's column than the one actually holding the bad value in the row
     * being inserted — naively parsing that text for "the" bad column would point at the wrong
     * table entirely (see ImportChunkRowProcessor#insertIndividually, the only caller).
     */
    public List<String> getForeignKeyLocalColumns(String constraintName) {
        return jdbcTemplate.queryForList(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE " +
                        "WHERE TABLE_SCHEMA = " + dialect.currentSchemaFn() + " AND CONSTRAINT_NAME = ? ORDER BY ORDINAL_POSITION",
                new Object[]{constraintName},
                String.class);
    }

    /**
     * One FOREIGN KEY constraint declared on a table, resolved down to its actual columns —
     * {@code localColumns} (this table's own columns, in constraint order) and the
     * {@code referencedTable}/{@code referencedColumns} they point at. Supports composite FKs (e.g.
     * {@code FK_PrimarySales_BatchMaster} on {@code (Article_Code, Batch_Code)}) — {@code localColumns}
     * and {@code referencedColumns} are always the same length, paired by position.
     */
    public record ForeignKeyRef(String constraintName, List<String> localColumns, String referencedTable,
                                 List<String> referencedColumns) {
    }

    /**
     * Every FOREIGN KEY constraint declared on {@code tableName}, read live from the database's own
     * INFORMATION_SCHEMA rather than hardcoded per table — added for {@code ImportForeignKeyPreCheck},
     * which needs to discover an upload target's own FK relationships generically (Primary_Sales'
     * Bill_to/Ship_to pointing at Site_Master, Batch_Master's Article_Code pointing at Product_Master,
     * etc.) without a separate hand-maintained list per table. MySQL's
     * INFORMATION_SCHEMA.KEY_COLUMN_USAGE carries REFERENCED_TABLE_NAME/REFERENCED_COLUMN_NAME directly.
     */
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

    /**
     * Identity columns — upload templates/validation/inserts all need to know which columns those
     * are, since AUTO_INCREMENT columns can never be given an explicit value in a plain INSERT
     * (see {@link #setIdentityInsert}) and so must always be excluded from a generated template/from
     * "missing required column" validation.
     */
    public Set<String> getIdentityColumns(String tableName) {
        // auto_increment is exposed via INFORMATION_SCHEMA.COLUMNS.EXTRA.
        String sql = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA = 'auto_increment'";
        List<String> columns = jdbcTemplate.queryForList(sql, new Object[]{tableName}, String.class);
        return new LinkedHashSet<>(columns);
    }

    /**
     * Computed (generated) columns can never be given an explicit value in an INSERT — the database
     * rejects it outright — so uploads must always exclude them and let the database fill them in
     * itself.
     */
    public Set<String> getComputedColumns(String tableName) {
        // MySQL generated columns report 'STORED GENERATED'/'VIRTUAL GENERATED' in EXTRA.
        String sql = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA LIKE '%GENERATED%'";
        List<String> columns = jdbcTemplate.queryForList(sql, new Object[]{tableName}, String.class);
        return new LinkedHashSet<>(columns);
    }

    // CHANGED: used by ImportProcessingService for any non-identity numeric column it needs to
    // auto-sequence itself — generalized to any column literally named "SN" on any table
    // (Batch_Master, Product_Master too — SN there isn't even the primary key). Returns the next
    // value the app should use — one past whatever's already in the table.
    public long getNextNumericColumnValue(String table, String column) {
        Long max = jdbcTemplate.queryForObject(
                "SELECT MAX(" + quote(column) + ") FROM " + quote(table), Long.class);
        return (max == null ? 0L : max) + 1;
    }

    /**
     * No-op on MySQL (kept for call-site compatibility) — an AUTO_INCREMENT column always accepts an explicit value; formerly toggled a session-level identity switch for {@code table} — required before
     * an INSERT can supply an explicit value for an IDENTITY column (e.g. app-managed sequential SN
     * values), and must be turned back off afterward since only one table per session may have it on
     * at a time.
     */
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

    /**
     * For tables without a primary key, a row is located by matching every (comparable) column's
     * current value (there's no other stable way to identify "this row" over a plain JDBC
     * connection). text/blob-family columns are dropped from the match — MySQL cannot
     * compare them with "=" reliably — so two rows differing only in such a column are still treated
     * as ambiguous by the caller's match-count check rather than silently conflated.
     */
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

    /**
     * Deletes the row(s) matching {@code matchColumns}. Callers pass primary-key values when the
     * table has a key, or the full pre-edit row (see {@link #countFullMatch}) when it doesn't.
     */
    public int applyDelete(String table, Map<String, Object> matchColumns) {
        StringBuilder sql = new StringBuilder("DELETE FROM ").append(quote(table)).append(" WHERE ");
        List<Object> params = new ArrayList<>();
        appendWhereClause(sql, params, comparableColumns(table, matchColumns));

        return jdbcTemplate.update(sql.toString(), params.toArray());
    }

    // Empties a table AND resets its identity seed (e.g. SN) back to its original starting value in
    // one atomic step — a plain DELETE would clear the rows but leave the identity counter wherever
    // it was, so the next insert would still continue from the old high-water mark instead of
    // restarting at 1. table is validated by the caller (see validateTable) before reaching here, so
    // this is never fed anything outside the real INFORMATION_SCHEMA table list.
    //
    // TRUNCATE TABLE is a schema-level restriction in MySQL — it fails whenever ANY other
    // table has an FK pointing at this one, regardless of whether that other table currently has zero
    // rows. Falls back to a plain DELETE in that case — matched on "foreign key" case-insensitively,
    // which MySQL's error text ("Cannot truncate a table referenced in a foreign key constraint") satisfies.
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

    /**
     * Records each successfully-committed row's absolute position in its source upload file, keyed
     * by its own primary-key value — see database/01_schema.sql's table_row_order for why this
     * exists (SN was dropped from Site_Master/Product_Master/Batch_Master's live schema, so a
     * business-key clustered index is otherwise all a plain SELECT has to sort by). Upserts rather
     * than plain-inserts since re-uploading an existing key should replace its old position, not
     * throw a duplicate-key error.
     */
    public void recordRowOrder(String table, Map<String, Long> pkValueToSeq) {
        if (pkValueToSeq.isEmpty() || !tableRowOrderExists()) {
            return;
        }
        List<Object[]> batchArgs = pkValueToSeq.entrySet().stream()
                .map(e -> new Object[]{table, e.getKey(), e.getValue()})
                .toList();
        jdbcTemplate.batchUpdate(upsertRowOrderSql, batchArgs);
    }

    // Called from truncateTable so a wiped table's stale positions don't linger for keys that no
    // longer exist (harmless if they did — a LEFT JOIN with no matching row just falls through to
    // no order — but unbounded over repeated truncate/re-upload cycles otherwise).
    private void clearRowOrder(String table) {
        if (!tableRowOrderExists()) {
            return;
        }
        jdbcTemplate.update("DELETE FROM table_row_order WHERE table_key = ?", table);
    }

    // table_last_import (database/migrations/2026-09-03_create_table_last_import.sql) — same
    // graceful-when-missing/cached-for-the-JVM convention as tableRowOrderExists above. Exists
    // because import_sessions.committedAt (what DatabaseConnectionController#getTableSummary used to
    // read "last import" from exclusively) is transient working data, auto-deleted after its own
    // calendar day (see ImportSessionCleanupService) — a table imported into once and never touched
    // since would incorrectly show "No import yet" the day after, even though it genuinely was
    // imported. This table is a real permanent record instead, one row per table_key, upserted on
    // every real commit regardless of retention.
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

    // Called from ImportAtomicCommitRunner.run right after a real (non-aborted) commit transaction —
    // see that class's own comment on what "aborted" excludes (a Cancelled/critically-failed run that
    // rolled back everything, where nothing genuinely landed). Best-effort, same as recordRowOrder —
    // this only feeds the Explorer's "last import" display, never the import itself.
    public void recordLastImport(String table) {
        if (!tableLastImportExists()) {
            return;
        }
        jdbcTemplate.update(upsertLastImportSql, table, LocalDateTime.now());
    }

    // Real, permanent last-import timestamp for `table` — null if this table has never had a real
    // commit recorded here (either genuinely never imported, or imported before this table existed /
    // before an app restart picked it up, see tableLastImportExists's own comment).
    public LocalDateTime getLastImportedAt(String table) {
        if (!tableLastImportExists()) {
            return null;
        }
        List<LocalDateTime> rows = jdbcTemplate.query(
                "SELECT last_committed_at FROM table_last_import WHERE table_key = ?",
                (rs, rowNum) -> rs.getTimestamp("last_committed_at").toLocalDateTime(), table);
        return rows.isEmpty() ? null : rows.get(0);
    }

    // Multiplies every row's value in a single numeric column by `factor` in one UPDATE — e.g.
    // bringing an unrealistically high bulk-imported target column down to a level closer to
    // actually-achieved figures, without disturbing the relative distribution across rows (brand,
    // partner, month, etc. all stay proportional to each other, just uniformly scaled). Column is
    // checked against the table's real numeric columns first so this can never be pointed at an
    // arbitrary or non-numeric column.
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

    /**
     * Inserts every row in one round trip via a JDBC batch instead of one INSERT per row. Per the
     * JDBC contract, this either fully succeeds (every row inserted) or throws — a driver never
     * returns normally with some rows silently failed — so the caller can safely fall back to
     * inserting one-by-one (to pin down exactly which row failed and why) only when this throws,
     * and get the full speed benefit whenever the batch is clean, which is the common case.
     * Every row must supply the exact same set of columns, in the same order.
     */
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

    /**
     * For each of the given key-value maps (same NULL-safe equality semantics as
     * {@link #countFullMatch}), determines whether a matching row already exists — as one query
     * for the whole list instead of one round trip per row. Returns the indexes (into {@code
     * keyMaps}) whose values already exist in the table.
     *
     * <p>Each distinct key combination is tagged with a SQL {@code CASE} branch so the actual
     * value comparison (e.g. the uploaded text "123" against a numeric or date column) is done by
     * the database itself, exactly as a normal parameterized query would — never by comparing the
     * Java values directly, which could disagree with the database's own type coercion.
     */
    public Set<Integer> findExistingRowIndexes(String table, List<Map<String, Object>> keyMaps) {
        if (keyMaps.isEmpty()) {
            return Set.of();
        }

        // The same key combination can appear in more than one input row (e.g. two rows in the
        // file share a key) — de-duplicate so the query has one branch per distinct combination.
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

        // Each distinct tuple contributes its (non-null) key values twice — once in the CASE
        // branch, once in the WHERE clause — so a chunk-sized batch of distinct tuples can trip
        // MySQL's prepared-statement placeholder cap. Split into sub-batches that stay
        // comfortably under that limit and merge the results, instead of firing one unbounded query
        // per chunk.
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
