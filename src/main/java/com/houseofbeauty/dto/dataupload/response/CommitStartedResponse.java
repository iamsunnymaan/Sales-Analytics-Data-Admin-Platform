package com.houseofbeauty.dto.dataupload.response;

/** POST /{id}/commit's immediate ack — the actual insert runs in the background (see CommitStatusResponse). */
public record CommitStartedResponse(boolean started, int totalRows) {
}
