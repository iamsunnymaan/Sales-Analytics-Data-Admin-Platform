package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;


public final class ImportPrimarySales implements TableImportRules {

    public static final ImportPrimarySales INSTANCE = new ImportPrimarySales();
    public static final String TABLE_KEY = "Primary_Sales";

    private ImportPrimarySales() {
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
