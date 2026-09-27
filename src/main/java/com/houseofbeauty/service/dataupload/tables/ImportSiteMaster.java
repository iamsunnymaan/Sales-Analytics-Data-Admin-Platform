package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;

/**
 * Import rules for {@code Site_Master}. Its primary key (Site_Code) is a genuine business key,
 * so this uses the default, generic behavior: every uploaded row IS duplicate-checked against the
 * table's live primary key, and a row whose key already exists is skipped as a duplicate rather than
 * re-inserted — see {@link TableImportRules#alwaysInsertNew}.
 */
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
