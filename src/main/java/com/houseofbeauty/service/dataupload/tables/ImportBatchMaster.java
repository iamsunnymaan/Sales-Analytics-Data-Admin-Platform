package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;


public final class ImportBatchMaster implements TableImportRules {

    public static final ImportBatchMaster INSTANCE = new ImportBatchMaster();
    public static final String TABLE_KEY = "Batch_Master";

    private ImportBatchMaster() {
    }

    @Override
    public String tableKey() {
        return TABLE_KEY;
    }

    @Override
    public boolean alwaysInsertNew() {
        return false;
    }
}
