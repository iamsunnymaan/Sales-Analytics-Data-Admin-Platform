package com.houseofbeauty.service.dataupload.import_common;

public final class ImportLimits {

    public static final int CHUNK_SIZE = 2000;

    public static final int MAX_PARALLEL_CHUNKS = 6;

    public static final int MAX_INVALID_ROWS = 25;

    public static final int DISPLAYED_LEADING_ERRORS = 5;

    public static final int FULL_SCAN_ROW_BUDGET = 100_000;

    private ImportLimits() {
    }
}
