package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;

/**
 * Import rules for {@code Batch_Master}. {@code Batch_Code} is its real primary key (a genuine
 * business key, not a surrogate) and must stay unique — so this uses the default, generic behavior:
 * every uploaded row IS duplicate-checked against the table's live primary key (see
 * {@code TableAccessService#getPrimaryKeyColumns}), and a row whose {@code Batch_Code} already exists
 * is skipped as a duplicate rather than re-inserted. Declared explicitly here (rather than left
 * implicit) since it's the rule this table was specifically called out for.
 */
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
