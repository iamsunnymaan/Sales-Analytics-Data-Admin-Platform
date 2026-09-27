package com.houseofbeauty.dto.explorer.response;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * GET /api/database/tables/{tableName}/data's response for the Explorer grid. {@code rows} stays a
 * plain map per row because its keys are the table's own columns, which vary per table — there's no
 * fixed shape to give it a typed field for.
 */
public record TableDataResponse(String tableName, List<String> columns, List<String> sortableColumns,
                                 List<String> primaryKeyColumns, Set<String> computedColumns,
                                 List<String> dateColumns, List<Map<String, Object>> rows, long totalRows,
                                 int page, int size, String sortColumn, String sortDir) {
}
