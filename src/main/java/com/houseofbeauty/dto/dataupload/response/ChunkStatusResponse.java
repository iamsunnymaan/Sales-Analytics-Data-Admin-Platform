package com.houseofbeauty.dto.dataupload.response;

/**
 * One chunk's live state within a /process or /commit job's status poll — real per-chunk bookkeeping
 * from {@link com.houseofbeauty.controller.pages.dataupload.ImportProcessJobTracker}, not a simulated
 * visualization: {@code lane} is which of the job's parallel worker slots this chunk runs (or ran) on,
 * {@code status} is one of "pending" (not yet started), "running", "passed" (finished, no
 * invalid/duplicate rows), "flagged" (finished, contains invalid/duplicate rows), or "aborted" (stopped
 * partway through — the invalid-row cap was hit mid-chunk, or a system failure hit this chunk), and
 * {@code rowsDone}/{@code rowsTotal} are how many of this chunk's own rows were actually processed.
 */
public record ChunkStatusResponse(int index, int lane, String status, int rowsDone, int rowsTotal) {
}
