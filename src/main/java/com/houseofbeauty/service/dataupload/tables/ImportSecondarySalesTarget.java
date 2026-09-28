package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;


public final class ImportSecondarySalesTarget implements TableImportRules {

    public static final ImportSecondarySalesTarget INSTANCE = new ImportSecondarySalesTarget();
    public static final String TABLE_KEY = "Secondary_Sales_Target";

    private ImportSecondarySalesTarget() {
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
