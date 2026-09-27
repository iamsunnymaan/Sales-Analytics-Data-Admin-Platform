package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;

/**
 * Import rules for {@code Secondary_Sales}. Same reasoning as {@link ImportPrimarySales}: its
 * primary key (SN) is a surrogate row-counter with no business meaning — an uploaded file that
 * happens to number its own rows 1, 2, 3... would otherwise collide with whichever values already
 * exist in the table and get wrongly flagged as duplicates, even when every other column is
 * completely different data. So: duplicates are never checked here, and that key column is always
 * app-managed (auto-generated, continuing from the current max value) rather than taken from the
 * file — see {@link TableImportRules#alwaysInsertNew}.
 */
public final class ImportSecondarySales implements TableImportRules {

    public static final ImportSecondarySales INSTANCE = new ImportSecondarySales();
    public static final String TABLE_KEY = "Secondary_Sales";

    private ImportSecondarySales() {
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
