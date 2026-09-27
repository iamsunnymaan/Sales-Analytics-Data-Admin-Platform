package com.houseofbeauty.controller.pages.dataupload;

import com.houseofbeauty.service.common.TableAccessService;
import com.houseofbeauty.service.dataupload.import_common.ImportProcessingService;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Checks an uploaded file's header row against the target table's actual columns so a mismatched
 * file (wrong table, renamed/reordered/missing columns) is rejected up front with a specific reason,
 * rather than being queued and failing silently later. Used only by {@link ImportSessionController#upload}.
 */
class ImportColumnValidator {

    private final TableAccessService tableAccessService;
    private final ImportProcessingService importProcessingService;

    ImportColumnValidator(TableAccessService tableAccessService, ImportProcessingService importProcessingService) {
        this.tableAccessService = tableAccessService;
        this.importProcessingService = importProcessingService;
    }

    void validate(String table, List<String> uploadedHeaders) {
        List<String> nonBlankHeaders = uploadedHeaders.stream().filter(h -> !h.isBlank()).toList();
        if (nonBlankHeaders.isEmpty()) {
            throw new IllegalArgumentException("The uploaded file has no header row (first row must list the column names).");
        }

        Set<String> tableColumns = tableAccessService.getColumnTypes(table).keySet();
        Set<String> identityColumns = tableAccessService.getIdentityColumns(table);
        Set<String> computedColumns = tableAccessService.getComputedColumns(table);
        // Identity (auto-increment) and computed columns are optional in the file — the database
        // generates them, so they're never "missing", but they're tolerated (and ignored) if included.
        Set<String> alwaysGeneratedColumns = new HashSet<>(identityColumns);
        alwaysGeneratedColumns.addAll(computedColumns);
        // Any column literally named "SN" that isn't a real DB identity column is optional in the
        // file too — ImportProcessingService always auto-generates it, continuing the existing
        // sequence rather than trusting whatever the file supplies, on every table that has an SN
        // column (not just ones where SN happens to be the primary key).
        String snColumn = tableColumns.stream().filter(c -> c.equalsIgnoreCase("SN")).findFirst().orElse(null);
        if (snColumn != null && !identityColumns.contains(snColumn)) {
            alwaysGeneratedColumns.add(snColumn);
        }
        // On an alwaysAutoGenerate table (see ImportProcessingService.alwaysAutoGeneratesPrimaryKey),
        // the primary key is optional too even when it isn't a real DB identity column and isn't
        // named SN (not currently the case for any table, but keeps this correct if one is added) —
        // the app assigns it a value itself exactly like a real identity column.
        if (importProcessingService.alwaysAutoGeneratesPrimaryKey(table)) {
            alwaysGeneratedColumns.addAll(tableAccessService.getPrimaryKeyColumns(table));
        }
        List<String> requiredColumns = tableColumns.stream()
                .filter(c -> !alwaysGeneratedColumns.contains(c))
                .toList();
        // A NULLable column (e.g. Product_Master.Uploaded_At, Site_Master.Brand) is optional in the
        // file too — omitting it just means those cells land as real SQL NULL, same as leaving a
        // per-row cell blank already does. Only genuinely NOT NULL columns are actually "missing"
        // errors; requiredColumns above still lists every column (nullable or not) for the "Expected
        // columns" message text.
        Set<String> nullableColumns = tableAccessService.getNullableColumns(table);
        List<String> strictlyRequiredColumns = requiredColumns.stream()
                .filter(c -> !nullableColumns.contains(c))
                .toList();

        Set<String> tableColumnsLower = new LinkedHashSet<>();
        tableColumns.forEach(c -> tableColumnsLower.add(c.toLowerCase(Locale.ROOT)));

        Set<String> uploadedLower = new LinkedHashSet<>();
        nonBlankHeaders.forEach(h -> uploadedLower.add(h.toLowerCase(Locale.ROOT)));

        List<String> unrecognizedColumns = nonBlankHeaders.stream()
                .filter(h -> !tableColumnsLower.contains(h.toLowerCase(Locale.ROOT)))
                .toList();
        List<String> missingColumns = strictlyRequiredColumns.stream()
                .filter(c -> !uploadedLower.contains(c.toLowerCase(Locale.ROOT)))
                .toList();

        if (!unrecognizedColumns.isEmpty() || !missingColumns.isEmpty()) {
            StringBuilder message = new StringBuilder("The uploaded file's columns don't match table '" + table + "'.");
            if (!missingColumns.isEmpty()) {
                message.append(" Missing: ").append(String.join(", ", missingColumns)).append(".");
            }
            if (!unrecognizedColumns.isEmpty()) {
                message.append(" Unrecognized: ").append(String.join(", ", unrecognizedColumns)).append(".");
            }
            message.append(" Expected columns: ").append(String.join(", ", requiredColumns)).append(".");
            throw new IllegalArgumentException(message.toString());
        }
    }
}
