package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;

/**
 * Import rules for {@code Primary_Sales_Target}. The table has no surrogate ID column (its
 * former {@code TargetID} IDENTITY primary key was removed — the only real identifier left is the
 * DB-enforced {@code UQ_PrimaryTarget} unique constraint on Site_Code+Brand+Partner+Channel+Month),
 * so every upload always inserts fresh rows rather than checking for duplicates — see
 * {@link TableImportRules#alwaysInsertNew}.
 */
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
