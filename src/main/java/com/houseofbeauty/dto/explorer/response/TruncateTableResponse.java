package com.houseofbeauty.dto.explorer.response;

/** DELETE /api/database/tables/{tableName}/all-rows's response. */
public record TruncateTableResponse(boolean truncated, String table) {
}
