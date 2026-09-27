package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

/**
 * POST /{id}/process's completed-job payload (carried inside {@link ProcessStatusResponse#result()}).
 * {@code displayedInvalidRows}/{@code finalInvalidRow}/{@code message} are only populated when
 * {@code invalidRowLimitReached} is true (the 10-invalid-row cap was hit) — null/empty otherwise,
 * matching the pre-DTO behavior where those keys were simply absent from the response.
 */
public record ValidationResultResponse(String sessionId, String tableKey, String originalFilename, int totalRows,
                                        int validRows, int invalidRows, int duplicateRows, List<String> headers,
                                        List<RowResultResponse> rows, boolean invalidRowLimitReached,
                                        List<RowResultResponse> displayedInvalidRows, RowResultResponse finalInvalidRow,
                                        String message) {
}
