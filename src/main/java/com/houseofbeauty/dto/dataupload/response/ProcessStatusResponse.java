package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

public record ProcessStatusResponse(String status, int processedRows, int totalRows, int insertedSoFar,
                                     int duplicatesSoFar, int errorsSoFar, ValidationResultResponse result,
                                     String errorMessage, int workerCount, List<ChunkStatusResponse> chunks,
                                     List<RowResultResponse> liveInvalidRows) {
}
