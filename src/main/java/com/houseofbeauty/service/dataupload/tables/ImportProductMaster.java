package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;


public final class ImportProductMaster implements TableImportRules {

    public static final ImportProductMaster INSTANCE = new ImportProductMaster();
    public static final String TABLE_KEY = "Product_Master";

    private ImportProductMaster() {
    }

    @Override
    public String tableKey() {
        return TABLE_KEY;
    }
}
