package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

public record ValidationResultResponse(String sessionId, String tableKey, String originalFilename, int totalRows,
                                        int validRows, int invalidRows, int duplicateRows, List<String> headers,
                                        List<RowResultResponse> rows, boolean invalidRowLimitReached,
                                        List<RowResultResponse> displayedInvalidRows, RowResultResponse finalInvalidRow,
                                        String message) {
}
