package com.houseofbeauty.dto.dataupload.response;

public record ChunkStatusResponse(int index, int lane, String status, int rowsDone, int rowsTotal) {
}
