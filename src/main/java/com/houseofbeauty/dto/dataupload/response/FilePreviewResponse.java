package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

/** GET /{id}/preview's response — the uploaded file's own columns/rows, as parsed from the stored copy. */
public record FilePreviewResponse(List<String> columns, List<List<String>> rows) {
}
