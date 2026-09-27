package com.houseofbeauty.service.dataupload.tables;

import com.houseofbeauty.service.dataupload.import_common.TableImportRules;

/**
 * Import rules for {@code Primary_Sales}. Its primary key is a surrogate row-counter with no
 * business meaning — an uploaded file that happens to number its own rows 1, 2, 3... would otherwise
 * collide with whichever values already exist in the table and get wrongly flagged as duplicates,
 * even when every other column is completely different data. So: duplicates are never checked here,
 * and that key column is always app-managed (auto-generated, continuing from the current max value)
 * rather than taken from the file — see {@link TableImportRules#alwaysInsertNew}.
 */
public final class ImportPrimarySales implements TableImportRules {

    public static final ImportPrimarySales INSTANCE = new ImportPrimarySales();
    public static final String TABLE_KEY = "Primary_Sales";

    private ImportPrimarySales() {
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
