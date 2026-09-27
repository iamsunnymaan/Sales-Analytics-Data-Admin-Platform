package com.houseofbeauty.dto.dataupload.response;

import com.houseofbeauty.model.ImportSession;

/**
 * GET /upload/{uploadId}/status's poll response — {@code result} is only non-null once {@code status}
 * is "DONE"; {@code errorMessage} only non-null once {@code status} is "ERROR". Polled by
 * DataUploadPage.js every few hundred ms while a /upload job runs, the same way it already polls
 * /process/status and /commit/status. {@code processedRows}/{@code totalRows} are real rows parsed so
 * far (see ImportUploadFileParser's onRowParsed callback) — not a time-based simulation — so the
 * client can compute a genuine rows/sec rate and shrinking ETA the same way it already does for
 * Validate/Commit (see updateRowProgress in DataUploadPage.js).
 */
public record UploadStatusResponse(String status, int processedRows, int totalRows, ImportSession result,
                                    String errorMessage) {
}
