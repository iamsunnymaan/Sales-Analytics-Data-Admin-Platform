package com.houseofbeauty.dto.explorer.response;

import java.util.List;
import java.util.Map;
import java.util.Set;

public record TableDataResponse(String tableName, List<String> columns, List<String> sortableColumns,
                                 List<String> primaryKeyColumns, Set<String> computedColumns,
                                 List<String> dateColumns, List<Map<String, Object>> rows, long totalRows,
                                 int page, int size, String sortColumn, String sortDir) {
}
