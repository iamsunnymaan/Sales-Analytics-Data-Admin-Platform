package com.houseofbeauty.controller.pages.dataupload;

import com.houseofbeauty.service.common.TableAccessService;
import com.houseofbeauty.service.dataupload.import_common.ImportProcessingService;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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

        Set<String> alwaysGeneratedColumns = new HashSet<>(identityColumns);
        alwaysGeneratedColumns.addAll(computedColumns);

        String snColumn = tableColumns.stream().filter(c -> c.equalsIgnoreCase("SN")).findFirst().orElse(null);
        if (snColumn != null && !identityColumns.contains(snColumn)) {
            alwaysGeneratedColumns.add(snColumn);
        }

        if (importProcessingService.alwaysAutoGeneratesPrimaryKey(table)) {
            alwaysGeneratedColumns.addAll(tableAccessService.getPrimaryKeyColumns(table));
        }
        List<String> requiredColumns = tableColumns.stream()
                .filter(c -> !alwaysGeneratedColumns.contains(c))
                .toList();

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
