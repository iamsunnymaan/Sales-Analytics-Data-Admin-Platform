package com.houseofbeauty.dto.dataupload.response;

import java.util.List;

public record FilePreviewResponse(List<String> columns, List<List<String>> rows) {
}
