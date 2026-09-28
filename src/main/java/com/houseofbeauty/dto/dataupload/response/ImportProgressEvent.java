package com.houseofbeauty.dto.dataupload.response;

public record ImportProgressEvent(String stage, int pct, int processedRows, int totalRows, int insertedSoFar,
                                   int duplicatesSoFar, int errorsSoFar, Double rowsPerSec, Long etaSeconds) {
}
