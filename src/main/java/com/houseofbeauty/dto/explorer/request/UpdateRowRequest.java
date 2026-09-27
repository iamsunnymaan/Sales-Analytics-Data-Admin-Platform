package com.houseofbeauty.dto.explorer.request;

import java.util.Map;

/**
 * PUT /api/database/tables/{tableName}/rows's request body. {@code keys} identifies the row when the
 * table has a primary key; {@code originalRow} (every column's last-seen value) is the fallback used
 * to locate the row when it doesn't. {@code values} is the columns actually being changed. All three
 * are inherently dynamic (the table's own columns), so stay plain maps rather than fixed DTOs.
 */
public record UpdateRowRequest(Map<String, Object> keys, Map<String, Object> values,
                                Map<String, Object> originalRow) {
}
