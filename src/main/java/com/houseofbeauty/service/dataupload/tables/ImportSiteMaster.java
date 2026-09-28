package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;


public final class ImportSiteMaster implements TableImportRules {

    public static final ImportSiteMaster INSTANCE = new ImportSiteMaster();
    public static final String TABLE_KEY = "Site_Master";

    private ImportSiteMaster() {
    }

    @Override
    public String tableKey() {
        return TABLE_KEY;
    }
}
