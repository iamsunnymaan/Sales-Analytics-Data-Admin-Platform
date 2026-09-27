package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

/**
 * GET /{id}/process/status's poll response — {@code result} is only non-null once {@code status} is
 * "DONE"; {@code errorMessage} only non-null once {@code status} is "ERROR". Polled by
 * DataUploadPage.js every few hundred ms while a /process job runs.
 * {@code chunks}/{@code workerCount} are real per-chunk progress (see ChunkStatusResponse) — up to
 * ImportLimits.MAX_PARALLEL_CHUNKS chunks validate concurrently, so workerCount here can be &gt; 1.
 */
public record ProcessStatusResponse(String status, int processedRows, int totalRows, int insertedSoFar,
                                     int duplicatesSoFar, int errorsSoFar, ValidationResultResponse result,
                                     String errorMessage, int workerCount, List<ChunkStatusResponse> chunks,
                                     List<RowResultResponse> liveInvalidRows) {
}
