package com.houseofbeauty.dto.dataupload.response;

/** POST /{id}/process's immediate ack — the actual validation runs in the background (see ProcessStatusResponse). */
public record ProcessStartedResponse(boolean started, int totalRows) {
}
