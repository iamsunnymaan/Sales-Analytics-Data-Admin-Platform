package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;


public final class ImportPrimarySalesTarget implements TableImportRules {

    public static final ImportPrimarySalesTarget INSTANCE = new ImportPrimarySalesTarget();
    public static final String TABLE_KEY = "Primary_Sales_Target";

    private ImportPrimarySalesTarget() {
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
