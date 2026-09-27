package com.houseofbeauty.service.dataupload.import_common;

// Single source of truth for the upload pipeline's chunking/concurrency/validation-cap numbers —
// referenced by ImportProcessingService (enforces them) and ImportSessionController (mirrors
// MAX_INVALID_ROWS/DISPLAYED_LEADING_ERRORS when slicing the capped error list for the UI) so
// there's exactly one place to change any of them.
public final class ImportLimits {

    // Rows per validation/commit chunk. Must stay > 0; the final chunk of a file naturally holds
    // fewer rows when the file size isn't an exact multiple (see partition()).
    public static final int CHUNK_SIZE = 2000;

    // Maximum number of chunks validated concurrently during Preview. Never exceeded — chunk
    // scheduling is gated by a semaphore sized to this value (see ImportProcessingService). Also
    // sizes importChunkExecutor's core pool (see ImportExecutorConfig).
    public static final int MAX_PARALLEL_CHUNKS = 6;

    // Hard stop: validation (and the commit path's own fresh re-validation) never admits more than
    // this many invalid rows into a single attempt's result before cancelling all further work.
    public static final int MAX_INVALID_ROWS = 25;

    // Of the (at most MAX_INVALID_ROWS) captured invalid rows, how many leading ones are shown in
    // full before the UI collapses the rest behind an ellipsis and shows only the final one.
    public static final int DISPLAYED_LEADING_ERRORS = 5;

    // The Data Preview card's "scan entire file & download all" option deliberately ignores each
    // table's normal MAX_INVALID_ROWS-scale budget (the whole point of that budget is to fail a bad
    // file fast rather than fully scanning it) and substitutes this much larger one instead, so the
    // download can include every invalid/duplicate row the file actually has. Still a hard ceiling,
    // not "unlimited" — protects memory/response size against a pathological file that's bad on
    // nearly every row.
    public static final int FULL_SCAN_ROW_BUDGET = 100_000;

    private ImportLimits() {
    }
}
