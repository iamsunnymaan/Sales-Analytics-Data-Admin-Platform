package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

/**
 * GET /{id}/commit/status's poll response — {@code result} is only non-null once {@code status} is
 * "DONE"; {@code errorMessage} only non-null once {@code status} is "ERROR". Polled by
 * DataUploadPage.js every few hundred ms while a /commit job runs, mirroring
 * ProcessStatusResponse's shape for the validate phase. {@code workerCount} is always 1 here — Commit
 * runs every chunk sequentially inside one transaction (see ImportAtomicCommitRunner), unlike Preview's
 * bounded-parallel chunks.
 */
public record CommitStatusResponse(String status, int processedRows, int totalRows, int insertedSoFar,
                                    int duplicatesSoFar, int errorsSoFar, CommitResultResponse result,
                                    String errorMessage, int workerCount, List<ChunkStatusResponse> chunks,
                                    List<RowResultResponse> liveInvalidRows) {
}
