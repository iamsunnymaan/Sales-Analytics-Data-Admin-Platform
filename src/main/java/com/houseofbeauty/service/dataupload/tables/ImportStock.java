package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;

/**
 * Import rules for {@code Stock}. Like {@code Primary_Sales}, its primary key ({@code SN}) is a
 * surrogate row-counter with no business meaning — a daily stock-on-hand snapshot per
 * Site+Article+Batch, so the same (Stock_Date, Site_Code, Article_Code, Batch_Code) combination is
 * only ever meant to appear once (enforced by the table's own UNIQUE constraint), but SN itself
 * carries no identity to duplicate-check against. See {@link TableImportRules#alwaysInsertNew}.
 */
public final class ImportStock implements TableImportRules {

    public static final ImportStock INSTANCE = new ImportStock();
    public static final String TABLE_KEY = "Stock";

    private ImportStock() {
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
