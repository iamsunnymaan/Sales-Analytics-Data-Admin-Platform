package com.houseofbeauty.dto.explorer.response;

/** GET /api/database/connection's response — backs the Explorer/Upload UI's connection banner. */
public record ConnectionStatusResponse(String serverName, String databaseName, String status) {
}
