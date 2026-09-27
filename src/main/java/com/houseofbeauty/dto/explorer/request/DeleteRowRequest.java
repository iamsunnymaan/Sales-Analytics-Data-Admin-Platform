package com.houseofbeauty.dto.explorer.request;

import java.util.Map;

/** DELETE /api/database/tables/{tableName}/rows's request body — see {@link UpdateRowRequest}. */
public record DeleteRowRequest(Map<String, Object> keys, Map<String, Object> originalRow) {
}
