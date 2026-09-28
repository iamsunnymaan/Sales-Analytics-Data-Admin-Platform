package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;


public final class ImportSecondarySales implements TableImportRules {

    public static final ImportSecondarySales INSTANCE = new ImportSecondarySales();
    public static final String TABLE_KEY = "Secondary_Sales";

    private ImportSecondarySales() {
    }

    @Override
    public String tableKey() {
        return TABLE_KEY;
    }

    @Override
    public boolean alwaysInsertNew() {
        return true;
    }
}
