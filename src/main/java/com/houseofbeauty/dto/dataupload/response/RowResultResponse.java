package com.houseofbeauty.dto.dataupload.response;

import java.util.Map;

/**
 * One row's outcome from a Preview (dry-run) or Commit run — mirrors
 * {@link com.houseofbeauty.service.dataupload.import_common.ImportProcessingService.RowResult} for the JSON API.
 * {@code data} stays a plain map because its keys are the uploaded table's own columns, which vary
 * per table — there's no fixed shape to give it a typed field for.
 */
public record RowResultResponse(int rowNumber, String status, Map<String, Object> data, String errorColumn,
                                 String errorMessage, String solution) {
}
