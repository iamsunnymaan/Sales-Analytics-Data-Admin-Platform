package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;

/**
 * Import rules for {@code Secondary_Sales_Target}. Same reasoning as
 * {@link ImportPrimarySalesTarget}: the table has no surrogate ID column at all — its only real
 * identifier is the DB-enforced {@code UQ_SecondaryTarget} unique constraint on
 * Site_Code+Brand+Partner+Month — so every upload always inserts fresh rows rather than checking
 * for duplicates — see {@link TableImportRules#alwaysInsertNew}.
 */
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
