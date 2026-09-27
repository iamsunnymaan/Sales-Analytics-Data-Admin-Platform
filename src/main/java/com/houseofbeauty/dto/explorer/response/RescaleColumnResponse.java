package com.houseofbeauty.dto.explorer.response;

/** POST /api/database/tables/{tableName}/rescale-column's response. */
public record RescaleColumnResponse(String table, String column, double factor, int rowsUpdated) {
}
