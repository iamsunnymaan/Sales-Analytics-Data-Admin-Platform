package com.houseofbeauty.dto.explorer.request;

import java.util.Map;

public record DeleteRowRequest(Map<String, Object> keys, Map<String, Object> originalRow) {
}
