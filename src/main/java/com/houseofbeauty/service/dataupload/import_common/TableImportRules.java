package com.houseofbeauty.service.dataupload.import_common;

public interface TableImportRules {

    String tableKey();

    default boolean alwaysInsertNew() {
        return false;
    }

    default int invalidRowBudget() {
        return ImportLimits.MAX_INVALID_ROWS;
    }
}
