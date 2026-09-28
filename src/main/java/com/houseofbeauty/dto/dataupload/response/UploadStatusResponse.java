package com.houseofbeauty.dto.dataupload.response;

import com.houseofbeauty.model.ImportSession;

public record UploadStatusResponse(String status, int processedRows, int totalRows, ImportSession result,
                                    String errorMessage) {
}
