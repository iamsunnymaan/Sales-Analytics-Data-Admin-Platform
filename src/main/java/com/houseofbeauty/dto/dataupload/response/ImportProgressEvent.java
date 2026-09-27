package com.houseofbeauty.dto.dataupload.response;

/**
 * One live-progress push over SSE (see ImportSseEmitterRegistry) — fired once per chunk boundary
 * during a /process (stage "VALIDATE") or /commit (stage "COMMIT") run, mirroring exactly the same
 * counters {@code ProcessStatusResponse}/{@code CommitStatusResponse} report to a polling client, so
 * the two transports never disagree. rowsPerSec/etaSeconds are null until at least one row has been
 * processed (a rate is meaningless before that).
 */
public record ImportProgressEvent(String stage, int pct, int processedRows, int totalRows, int insertedSoFar,
                                   int duplicatesSoFar, int errorsSoFar, Double rowsPerSec, Long etaSeconds) {
}
