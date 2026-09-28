package com.houseofbeauty.controller.common;

import com.houseofbeauty.dto.explorer.request.DeleteRowRequest;
import com.houseofbeauty.dto.explorer.response.DeleteRowResponse;
import com.houseofbeauty.dto.explorer.response.RescaleColumnResponse;
import com.houseofbeauty.dto.explorer.response.TableDataResponse;
import com.houseofbeauty.dto.explorer.response.TruncateTableResponse;
import com.houseofbeauty.dto.explorer.request.UpdateRowRequest;
import com.houseofbeauty.dto.explorer.response.UpdateRowResponse;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import com.houseofbeauty.service.common.TableAccessService;
import com.houseofbeauty.service.monitoring.MonitoringAuditService;
import com.houseofbeauty.util.SqlDialect;
import com.opencsv.CSVWriter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;


@RestController
@RequestMapping("/api/database/tables")
public class TableDataController {

    private static final int MAX_PAGE_SIZE = 200;
    private static final int MAX_EXCEL_ROWS = 1_048_575;


    private static final Set<String> NOT_SORTABLE_TYPES = Set.of("text", "ntext", "xml", "image");

    private static final Set<String> NOT_SEARCHABLE_TYPES = Set.of("binary", "varbinary", "image", "timestamp");


    private static final Set<String> DATE_COLUMN_TYPES = Set.of("date", "datetime", "timestamp");
    private static final DateTimeFormatter EXPORT_DATE_FORMAT = DateTimeFormatter.ofPattern("dd-MM-yyyy");
    private static final DateTimeFormatter EXPORT_DATETIME_FORMAT = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm:ss");

    private final JdbcTemplate jdbcTemplate;
    private final TableAccessService tableAccessService;
    private final MonitoringAuditService monitoringAuditService;
    private final SqlDialect dialect;

    public TableDataController(JdbcTemplate jdbcTemplate, TableAccessService tableAccessService,
                                MonitoringAuditService monitoringAuditService, SqlDialect dialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.tableAccessService = tableAccessService;
        this.monitoringAuditService = monitoringAuditService;
        this.dialect = dialect;
    }


    @GetMapping("/{tableName}/data")
    public TableDataResponse getTableData(@PathVariable String tableName,
                                             @RequestParam(defaultValue = "0") int page,
                                             @RequestParam(defaultValue = "50") int size,
                                             @RequestParam(required = false) String search,
                                             @RequestParam(required = false) String sortColumn,
                                             @RequestParam(defaultValue = "asc") String sortDir,
                                             @RequestParam(required = false) String dateColumn,
                                             @RequestParam(required = false) String dateFrom,
                                             @RequestParam(required = false) String dateTo) {
        String table = tableAccessService.validateTable(tableName);
        Map<String, String> columnTypes = tableAccessService.getColumnTypes(table);
        if (columnTypes.isEmpty()) {
            throw new IllegalArgumentException("Table has no columns: " + tableName);
        }

        List<String> columns = new ArrayList<>(columnTypes.keySet());
        List<String> sortableColumns = sortableColumns(columns, columnTypes);
        List<String> searchableColumns = searchableColumns(columns, columnTypes);
        List<String> primaryKeyColumns = tableAccessService.getPrimaryKeyColumns(table);
        Set<String> computedColumns = tableAccessService.getComputedColumns(table);
        List<String> dateColumns = dateColumns(columns, columnTypes);

        String[] order = resolveOrder(sortableColumns, sortColumn, sortDir);
        String orderColumn = order[0];
        String direction = order[1];
        String[] fromAndOrderBy = buildFromAndOrderBy(table, primaryKeyColumns, orderColumn, direction);
        String fromClause = fromAndOrderBy[0];
        String orderByClause = fromAndOrderBy[1];

        int safeSize = Math.max(1, Math.min(size, MAX_PAGE_SIZE));
        int safePage = Math.max(0, page);

        List<Object> whereParams = new ArrayList<>();
        String whereClause = buildWhereClause(searchableColumns, search, columnTypes,
                dateColumn, dateFrom, dateTo, whereParams);

        long totalRows = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + dialect.quote(table) + whereClause,
                whereParams.toArray(),
                Long.class);

        List<Object> dataParams = new ArrayList<>(whereParams);
        dataParams.add(safePage * safeSize);
        dataParams.add(safeSize);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT " + dialect.quote(table) + ".* FROM " + fromClause + whereClause +
                        " ORDER BY " + orderByClause +
                        " " + dialect.limitOffsetClause(),
                dataParams.toArray());

        return new TableDataResponse(table, columns, sortableColumns, primaryKeyColumns, computedColumns,
                dateColumns, rows, totalRows, safePage, safeSize, orderColumn, direction.toLowerCase());
    }

    @PutMapping("/{tableName}/rows")
    public UpdateRowResponse updateRow(@PathVariable String tableName, @RequestBody UpdateRowRequest payload) {
        String table = tableAccessService.validateTable(tableName);
        Map<String, String> columnTypes = tableAccessService.getColumnTypes(table);
        List<String> primaryKeyColumns = tableAccessService.getPrimaryKeyColumns(table);
        Set<String> computedColumns = tableAccessService.getComputedColumns(table);

        Map<String, Object> values = requireMap(payload.values(), "values");
        if (values.isEmpty()) {
            throw new IllegalArgumentException("No column values provided to update.");
        }
        for (String column : values.keySet()) {
            if (!columnTypes.containsKey(column)) {
                throw new IllegalArgumentException("Unknown column: " + column);
            }
            if (computedColumns.contains(column)) {
                throw new IllegalArgumentException("Column '" + column + "' is computed by the database and cannot be edited.");
            }
        }

        if (primaryKeyColumns.isEmpty()) {
            updateByFullRowMatch(table, columnTypes, payload, values);
        } else {
            updateByPrimaryKey(table, primaryKeyColumns, payload, values);
        }

        return new UpdateRowResponse(true);
    }


    private void updateByPrimaryKey(String table, List<String> primaryKeyColumns,
                                     UpdateRowRequest payload, Map<String, Object> values) {
        Map<String, Object> keys = requireMap(payload.keys(), "keys");
        if (!keys.keySet().equals(new HashSet<>(primaryKeyColumns))) {
            throw new IllegalArgumentException("Request 'keys' must match the table's primary key columns: " + primaryKeyColumns);
        }
        for (String column : values.keySet()) {
            if (primaryKeyColumns.contains(column)) {
                throw new IllegalArgumentException("Primary key column '" + column + "' cannot be edited.");
            }
        }

        int updated = tableAccessService.applyUpdate(table, keys, values);
        if (updated == 0) {
            throw new IllegalArgumentException("No matching row found to update; it may have been changed or deleted.");
        }
        if (updated > 1) {
            throw new IllegalStateException("Update unexpectedly matched more than one row; refusing to proceed further.");
        }
    }

    
    private void updateByFullRowMatch(String table, Map<String, String> columnTypes,
                                       UpdateRowRequest payload, Map<String, Object> values) {
        Map<String, Object> originalRow = requireMap(payload.originalRow(), "originalRow");
        if (!originalRow.keySet().equals(columnTypes.keySet())) {
            throw new IllegalArgumentException("Request 'originalRow' must include the current value of every column.");
        }

        int matchCount = tableAccessService.countFullMatch(table, originalRow);
        if (matchCount == 0) {
            throw new IllegalArgumentException("No matching row found to update; it may have been changed or deleted.");
        }
        if (matchCount > 1) {
            throw new IllegalArgumentException("This table has no primary key and " + matchCount +
                    " rows are identical to the one being edited, so the change can't be safely targeted.");
        }

        int updated = tableAccessService.applyUpdateByFullMatch(table, originalRow, values);
        if (updated != 1) {
            throw new IllegalStateException("Update unexpectedly affected " + updated + " rows; refusing to proceed further.");
        }
    }


    @DeleteMapping("/{tableName}/all-rows")
    @RequirePermission("page:data-upload.truncate-table")
    public TruncateTableResponse truncateTable(@PathVariable String tableName) {
        String table = tableAccessService.validateTable(tableName);
        tableAccessService.truncateTable(table);
        return new TruncateTableResponse(true, table);
    }


    @PostMapping("/{tableName}/rescale-column")
    @RequirePermission("page:data-upload.truncate-table")
    public RescaleColumnResponse rescaleColumn(@PathVariable String tableName,
                                                @RequestParam String column,
                                                @RequestParam double factor) {
        String table = tableAccessService.validateTable(tableName);
        int updated = tableAccessService.rescaleNumericColumn(table, column, factor);
        return new RescaleColumnResponse(table, column, factor, updated);
    }


    @DeleteMapping("/{tableName}/rows")
    public DeleteRowResponse deleteRow(@PathVariable String tableName, @RequestBody DeleteRowRequest payload) {
        String table = tableAccessService.validateTable(tableName);
        Map<String, String> columnTypes = tableAccessService.getColumnTypes(table);
        List<String> primaryKeyColumns = tableAccessService.getPrimaryKeyColumns(table);

        if (primaryKeyColumns.isEmpty()) {
            deleteByFullRowMatch(table, columnTypes, payload);
        } else {
            deleteByPrimaryKey(table, primaryKeyColumns, payload);
        }

        return new DeleteRowResponse(true);
    }

    private void deleteByPrimaryKey(String table, List<String> primaryKeyColumns, DeleteRowRequest payload) {
        Map<String, Object> keys = requireMap(payload.keys(), "keys");
        if (!keys.keySet().equals(new HashSet<>(primaryKeyColumns))) {
            throw new IllegalArgumentException("Request 'keys' must match the table's primary key columns: " + primaryKeyColumns);
        }

        int deleted = tableAccessService.applyDelete(table, keys);
        if (deleted == 0) {
            throw new IllegalArgumentException("No matching row found to delete; it may have already been removed.");
        }
        if (deleted > 1) {
            throw new IllegalStateException("Delete unexpectedly matched more than one row; refusing to proceed further.");
        }
    }

    
    private void deleteByFullRowMatch(String table, Map<String, String> columnTypes, DeleteRowRequest payload) {
        Map<String, Object> originalRow = requireMap(payload.originalRow(), "originalRow");
        if (!originalRow.keySet().equals(columnTypes.keySet())) {
            throw new IllegalArgumentException("Request 'originalRow' must include the current value of every column.");
        }

        int matchCount = tableAccessService.countFullMatch(table, originalRow);
        if (matchCount == 0) {
            throw new IllegalArgumentException("No matching row found to delete; it may have already been removed.");
        }
        if (matchCount > 1) {
            throw new IllegalArgumentException("This table has no primary key and " + matchCount +
                    " rows are identical to the one being deleted, so the delete can't be safely targeted.");
        }

        int deleted = tableAccessService.applyDelete(table, originalRow);
        if (deleted != 1) {
            throw new IllegalStateException("Delete unexpectedly affected " + deleted + " rows; refusing to proceed further.");
        }
    }


    @GetMapping("/{tableName}/template")
    public void downloadTemplate(@PathVariable String tableName, HttpServletResponse response) throws IOException {
        String table = tableAccessService.validateTable(tableName);
        Map<String, String> columnTypes = tableAccessService.getColumnTypes(table);
        if (columnTypes.isEmpty()) {
            throw new IllegalArgumentException("Table has no columns: " + tableName);
        }
        Set<String> identityColumns = tableAccessService.getIdentityColumns(table);
        Set<String> computedColumns = tableAccessService.getComputedColumns(table);
        List<String> columns = columnTypes.keySet().stream()
                .filter(c -> !identityColumns.contains(c) && !computedColumns.contains(c))
                .collect(Collectors.toCollection(ArrayList::new));

        response.setContentType("text/csv;charset=UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + table + "_template.csv\"");

        try (CSVWriter csvWriter = new CSVWriter(response.getWriter(), CSVWriter.DEFAULT_SEPARATOR,
                CSVWriter.DEFAULT_QUOTE_CHARACTER, CSVWriter.DEFAULT_ESCAPE_CHARACTER, "\r\n")) {
            csvWriter.writeNext(columns.toArray(new String[0]), false);
        }
    }


    @GetMapping("/{tableName}/export")
    @RequirePermission("page:explorer.table-data")
    public void exportTableData(@PathVariable String tableName,
                                 @RequestParam String format,
                                 @RequestParam(defaultValue = "all") String mode,
                                 @RequestParam(required = false) Integer start,
                                 @RequestParam(required = false) Integer end,
                                 @RequestParam(required = false) String search,
                                 @RequestParam(required = false) String sortColumn,
                                 @RequestParam(defaultValue = "asc") String sortDir,
                                 @RequestParam(required = false) String dateColumn,
                                 @RequestParam(required = false) String dateFrom,
                                 @RequestParam(required = false) String dateTo,
                                 HttpServletResponse response,
                                 HttpServletRequest request) throws IOException {
        try {
            doExportTableData(tableName, format, mode, start, end, search, sortColumn, sortDir,
                    dateColumn, dateFrom, dateTo, response);
            recordDownload(request, tableName + "." + format, tableName, true, null);
        } catch (Exception ex) {
            recordDownload(request, tableName + "." + format, tableName, false, ex.getMessage());
            throw ex;
        }
    }


    private void recordDownload(HttpServletRequest request, String fileName, String fileKey, boolean success, String failureReason) {
        HttpSession session = request.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;
        if (authUser == null) {
            return;
        }
        monitoringAuditService.recordDownload(authUser.getUserId(), authUser.getUsername(),
                request.getRemoteAddr(), fileName, fileKey, success, failureReason);
    }

    private void doExportTableData(String tableName, String format, String mode, Integer start, Integer end,
                                    String search, String sortColumn, String sortDir,
                                    String dateColumn, String dateFrom, String dateTo,
                                    HttpServletResponse response) throws IOException {
        if (!"csv".equalsIgnoreCase(format) && !"xlsx".equalsIgnoreCase(format)) {
            throw new IllegalArgumentException("Invalid format: must be 'csv' or 'xlsx'.");
        }

        String table = tableAccessService.validateTable(tableName);
        Map<String, String> columnTypes = tableAccessService.getColumnTypes(table);
        if (columnTypes.isEmpty()) {
            throw new IllegalArgumentException("Table has no columns: " + tableName);
        }

        List<String> columns = new ArrayList<>(columnTypes.keySet());
        List<String> sortableColumns = sortableColumns(columns, columnTypes);
        List<String> searchableColumns = searchableColumns(columns, columnTypes);
        List<String> primaryKeyColumns = tableAccessService.getPrimaryKeyColumns(table);

        String[] order = resolveOrder(sortableColumns, sortColumn, sortDir);
        String[] fromAndOrderBy = buildFromAndOrderBy(table, primaryKeyColumns, order[0], order[1]);
        String fromClause = fromAndOrderBy[0];
        String orderByClause = fromAndOrderBy[1];

        List<Object> params = new ArrayList<>();
        String whereClause = buildWhereClause(searchableColumns, search, columnTypes, dateColumn, dateFrom, dateTo, params);

        StringBuilder sql = new StringBuilder("SELECT ").append(dialect.quote(table)).append(".* FROM ").append(fromClause)
                .append(whereClause)
                .append(" ORDER BY ").append(orderByClause);

        String filenameSuffix;
        if ("range".equalsIgnoreCase(mode)) {
            if (start == null || end == null || start < 1 || end < start) {
                throw new IllegalArgumentException("Invalid range: start and end must be positive with end >= start.");
            }
            sql.append(" ").append(dialect.limitOffsetClause());
            params.add(start - 1);
            params.add(end - start + 1);
            filenameSuffix = "_rows_" + start + "-" + end;
        } else if ("all".equalsIgnoreCase(mode)) {
            filenameSuffix = "_all";
        } else {
            throw new IllegalArgumentException("Invalid mode: must be 'all' or 'range'.");
        }

        String baseFilename = table + filenameSuffix;

        if ("csv".equalsIgnoreCase(format)) {
            exportCsv(response, columns, columnTypes, sql.toString(), params, baseFilename);
        } else {
            exportXlsx(response, columns, columnTypes, sql.toString(), params, baseFilename);
        }
    }


    private String formatExportValue(Object value, String columnType) {
        if (value == null) {
            return "";
        }
        if (DATE_COLUMN_TYPES.contains(columnType)) {
            if (value instanceof java.sql.Timestamp timestamp) {
                LocalDateTime dateTime = timestamp.toLocalDateTime();
                return dateTime.toLocalTime().equals(LocalTime.MIDNIGHT)
                        ? dateTime.format(EXPORT_DATE_FORMAT)
                        : dateTime.format(EXPORT_DATETIME_FORMAT);
            }
            if (value instanceof java.sql.Date date) {
                return date.toLocalDate().format(EXPORT_DATE_FORMAT);
            }
        }
        return value.toString();
    }

    private void exportCsv(HttpServletResponse response, List<String> columns, Map<String, String> columnTypes,
                            String sql, List<Object> params, String filename) throws IOException {
        response.setContentType("text/csv;charset=UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + ".csv\"");

        try (CSVWriter csvWriter = new CSVWriter(response.getWriter(), CSVWriter.DEFAULT_SEPARATOR,
                CSVWriter.DEFAULT_QUOTE_CHARACTER, CSVWriter.DEFAULT_ESCAPE_CHARACTER, "\r\n")) {
            csvWriter.writeNext(columns.toArray(new String[0]), false);

            jdbcTemplate.query(sql, params.toArray(), (RowCallbackHandler) rs -> {
                String[] row = new String[columns.size()];
                for (int i = 0; i < columns.size(); i++) {
                    String column = columns.get(i);
                    row[i] = formatExportValue(rs.getObject(column), columnTypes.get(column));
                }
                csvWriter.writeNext(row, false);
            });
        }
    }

    private void exportXlsx(HttpServletResponse response, List<String> columns, Map<String, String> columnTypes,
                             String sql, List<Object> params, String filename) throws IOException {
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + ".xlsx\"");


        try (SXSSFWorkbook workbook = new SXSSFWorkbook(100)) {
            Sheet sheet = workbook.createSheet("Data");
            Row headerRow = sheet.createRow(0);
            for (int i = 0; i < columns.size(); i++) {
                headerRow.createCell(i).setCellValue(columns.get(i));
            }

            int[] nextRowIndex = {1};
            jdbcTemplate.query(sql, params.toArray(), (RowCallbackHandler) rs -> {
                if (nextRowIndex[0] > MAX_EXCEL_ROWS) {
                    return;
                }
                Row row = sheet.createRow(nextRowIndex[0]++);
                for (int i = 0; i < columns.size(); i++) {
                    String column = columns.get(i);
                    Object value = rs.getObject(column);
                    String columnType = columnTypes.get(column);
                    Cell cell = row.createCell(i);
                    if (value == null) {
                        cell.setBlank();
                    } else if (DATE_COLUMN_TYPES.contains(columnType)) {

                        cell.setCellValue(formatExportValue(value, columnType));
                    } else if (value instanceof Number number) {
                        cell.setCellValue(number.doubleValue());
                    } else if (value instanceof Boolean bool) {
                        cell.setCellValue(bool);
                    } else {
                        cell.setCellValue(value.toString());
                    }
                }
            });

            workbook.write(response.getOutputStream());
            workbook.dispose();
        }
    }

    private Map<String, Object> requireMap(Map<String, Object> value, String fieldName) {
        if (value == null) {
            throw new IllegalArgumentException("Request must include a '" + fieldName + "' object.");
        }
        return value;
    }

    private List<String> sortableColumns(List<String> columns, Map<String, String> columnTypes) {
        return columns.stream().filter(c -> !NOT_SORTABLE_TYPES.contains(columnTypes.get(c))).toList();
    }

    private List<String> searchableColumns(List<String> columns, Map<String, String> columnTypes) {
        return columns.stream().filter(c -> !NOT_SEARCHABLE_TYPES.contains(columnTypes.get(c))).toList();
    }


    private List<String> dateColumns(List<String> columns, Map<String, String> columnTypes) {
        return columns.stream().filter(c -> DATE_COLUMN_TYPES.contains(columnTypes.get(c))).toList();
    }


    private String[] resolveOrder(List<String> sortableColumns, String sortColumn, String sortDir) {
        String orderColumn = (sortColumn != null && sortableColumns.contains(sortColumn)) ? sortColumn : null;
        if (orderColumn == null) {
            orderColumn = sortableColumns.stream().filter(c -> c.equalsIgnoreCase("SN")).findFirst().orElse(null);
        }
        String direction = "desc".equalsIgnoreCase(sortDir) ? "DESC" : "ASC";
        return new String[]{orderColumn, direction};
    }


    private String[] buildFromAndOrderBy(String table, List<String> primaryKeyColumns, String orderColumn,
                                          String direction) {
        if (orderColumn != null) {
            return new String[]{dialect.quote(table), dialect.quote(orderColumn) + " " + direction};
        }
        if (!primaryKeyColumns.isEmpty() && tableAccessService.tableRowOrderExists()) {
            List<String> pkCasts = primaryKeyColumns.stream()
                    .map(pk -> dialect.castText(dialect.quote(table) + "." + dialect.quote(pk), 200))
                    .toList();
            List<String> concatParts = new ArrayList<>();
            for (int i = 0; i < pkCasts.size(); i++) {
                if (i > 0) {
                    concatParts.add(dialect.unitSeparatorLiteral());
                }
                concatParts.add(pkCasts.get(i));
            }
            String pkValueExpr = dialect.concat(concatParts.toArray(new String[0]));
            String from = dialect.quote(table) + " LEFT JOIN table_row_order ON table_row_order.table_key = '" + table
                    + "' AND table_row_order.pk_value = " + pkValueExpr;
            return new String[]{from, "table_row_order.seq " + direction};
        }
        return new String[]{dialect.quote(table), "(SELECT NULL)"};
    }


    private String buildWhereClause(List<String> searchableColumns, String search, Map<String, String> columnTypes,
                                     String dateColumn, String dateFrom, String dateTo, List<Object> params) {
        List<String> conditions = new ArrayList<>();

        if (search != null && !search.isBlank() && !searchableColumns.isEmpty()) {
            String likeTerm = "%" + search.trim() + "%";
            StringBuilder searchSql = new StringBuilder("(");
            for (int i = 0; i < searchableColumns.size(); i++) {
                if (i > 0) {
                    searchSql.append(" OR ");
                }
                searchSql.append(dialect.castText(dialect.quote(searchableColumns.get(i)), 4000)).append(" LIKE ?");
                params.add(likeTerm);
            }
            searchSql.append(")");
            conditions.add(searchSql.toString());
        }

        if (dateColumn != null && !dateColumn.isBlank()) {
            if (!columnTypes.containsKey(dateColumn)) {
                throw new IllegalArgumentException("Unknown column: " + dateColumn);
            }
            if (dateFrom == null || dateFrom.isBlank() || dateTo == null || dateTo.isBlank()) {
                throw new IllegalArgumentException("dateFrom and dateTo are required when dateColumn is set.");
            }

            conditions.add(dialect.quote(dateColumn) + " >= ? AND " + dialect.quote(dateColumn) + " < " + dialect.dateAddOneDay("?"));
            params.add(dateFrom);
            params.add(dateTo);
        }

        if (conditions.isEmpty()) {
            return "";
        }
        return " WHERE " + String.join(" AND ", conditions);
    }
}
