package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

public record CommitStatusResponse(String status, int processedRows, int totalRows, int insertedSoFar,
                                    int duplicatesSoFar, int errorsSoFar, CommitResultResponse result,
                                    String errorMessage, int workerCount, List<ChunkStatusResponse> chunks,
                                    List<RowResultResponse> liveInvalidRows) {
}
