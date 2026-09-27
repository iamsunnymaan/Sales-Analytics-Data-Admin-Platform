package com.houseofbeauty.dto.dataupload.response;

/**
 * POST /upload's immediate ack — the actual file scan/parse/store work runs in the background (see
 * {@link UploadStatusResponse}), the same split already used for /process and /commit. {@code uploadId}
 * is also the id the resulting {@link com.houseofbeauty.model.ImportSession} is saved under once the
 * job finishes, so the client doesn't need a second id to reconcile the two.
 */
public record UploadStartedResponse(boolean started, String uploadId) {
}
