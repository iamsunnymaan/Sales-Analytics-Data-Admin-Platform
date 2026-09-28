package com.houseofbeauty.dto.explorer.response;

public record RescaleColumnResponse(String table, String column, double factor, int rowsUpdated) {
}
