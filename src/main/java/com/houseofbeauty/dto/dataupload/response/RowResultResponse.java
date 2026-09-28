package com.houseofbeauty.dto.dataupload.response;

import java.util.Map;

public record RowResultResponse(int rowNumber, String status, Map<String, Object> data, String errorColumn,
                                 String errorMessage, String solution) {
}
