package com.houseofbeauty.dto.explorer.request;

import java.util.Map;

public record UpdateRowRequest(Map<String, Object> keys, Map<String, Object> values,
                                Map<String, Object> originalRow) {
}
