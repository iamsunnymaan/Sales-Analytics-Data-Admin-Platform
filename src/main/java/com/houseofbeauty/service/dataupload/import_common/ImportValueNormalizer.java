package com.houseofbeauty.service.dataupload.import_common;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;


final class ImportValueNormalizer {

    private ImportValueNormalizer() {
    }

    private static final Pattern COLUMN_NAME_PATTERN = Pattern.compile("column '([^']+)'", Pattern.CASE_INSENSITIVE);

    private static final Pattern FK_CONSTRAINT_NAME_PATTERN =
            Pattern.compile("CONSTRAINT `([^`]+)` FOREIGN KEY", Pattern.CASE_INSENSITIVE);

    private static final Pattern FK_VIOLATION_PHRASE_PATTERN =
            Pattern.compile("foreign key constraint", Pattern.CASE_INSENSITIVE);

    private static final Set<String> INTEGER_COLUMN_TYPES = Set.of("int", "bigint", "smallint", "tinyint");
    private static final Set<String> DECIMAL_COLUMN_TYPES = Set.of("decimal", "numeric", "float", "real", "money", "smallmoney");
    private static final Set<String> BIT_COLUMN_TYPES = Set.of("bit");

    private static final List<DateTimeFormatter> DATE_INPUT_FORMATS = List.of(
            DateTimeFormatter.ofPattern("uuuu-MM-dd", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("uuuu/MM/dd", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("dd-MM-uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("dd/MM/uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("MM-dd-uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("MM/dd/uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("dd.MM.uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("d-MMM-uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("d/MMM/uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("d-MMM-uu", Locale.ENGLISH)
    );

    
    static String normalizeDateText(String raw) {
        String trimmed = raw.trim();
        for (DateTimeFormatter format : DATE_INPUT_FORMATS) {
            try {
                LocalDate parsed = LocalDate.parse(trimmed, format.withResolverStyle(ResolverStyle.STRICT));
                return parsed.format(DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (DateTimeParseException ignored) {

            }
        }
        LocalDate serialDate = parseExcelSerialDate(trimmed);
        if (serialDate != null) {
            return serialDate.format(DateTimeFormatter.ISO_LOCAL_DATE);
        }
        return raw;
    }


    private static final LocalDate EXCEL_SERIAL_DATE_EPOCH = LocalDate.of(1899, 12, 30);

    private static final int MIN_PLAUSIBLE_SERIAL_DATE_YEAR = 1901;
    private static final int MAX_PLAUSIBLE_SERIAL_DATE_YEAR = 2200;

    private static LocalDate parseExcelSerialDate(String trimmed) {
        if (!trimmed.matches("\\d+")) {
            return null;
        }
        LocalDate date;
        try {
            date = EXCEL_SERIAL_DATE_EPOCH.plusDays(Long.parseLong(trimmed));
        } catch (RuntimeException e) {

            return null;
        }
        int year = date.getYear();
        return year >= MIN_PLAUSIBLE_SERIAL_DATE_YEAR && year <= MAX_PLAUSIBLE_SERIAL_DATE_YEAR ? date : null;
    }

    
    static String describeTypeMismatch(String columnType, String rawValue) {
        if (columnType == null) {
            return null;
        }
        String trimmed = rawValue.trim();
        if (INTEGER_COLUMN_TYPES.contains(columnType)) {
            try {
                Long.parseLong(trimmed);
                return null;
            } catch (NumberFormatException e) {
                return "expects a whole number";
            }
        }
        if (DECIMAL_COLUMN_TYPES.contains(columnType)) {
            try {
                new BigDecimal(trimmed);
                return null;
            } catch (NumberFormatException e) {
                return "expects a numeric value";
            }
        }
        if (BIT_COLUMN_TYPES.contains(columnType)) {
            String lower = trimmed.toLowerCase(Locale.ROOT);
            if (lower.equals("0") || lower.equals("1") || lower.equals("true") || lower.equals("false")) {
                return null;
            }
            return "expects a true/false value (0 or 1)";
        }
        return null;
    }

    static Set<String> lower(Collection<String> values) {
        return values.stream().map(v -> v.toLowerCase(Locale.ROOT)).collect(Collectors.toSet());
    }

    static <T> List<List<T>> partition(List<T> list, int size) {
        List<List<T>> chunks = new ArrayList<>();
        for (int i = 0; i < list.size(); i += size) {
            chunks.add(list.subList(i, Math.min(i + size, list.size())));
        }
        return chunks;
    }

    
    static boolean isForeignKeyViolation(String errorMessage) {
        return errorMessage != null && (FK_CONSTRAINT_NAME_PATTERN.matcher(errorMessage).find()
                || FK_VIOLATION_PHRASE_PATTERN.matcher(errorMessage).find());
    }

    
    static String extractForeignKeyConstraintName(String errorMessage) {
        if (errorMessage == null) {
            return null;
        }
        Matcher matcher = FK_CONSTRAINT_NAME_PATTERN.matcher(errorMessage);
        return matcher.find() ? matcher.group(1) : null;
    }

    
    static String extractErrorColumn(String errorMessage) {
        if (errorMessage == null) {
            return null;
        }
        Matcher matcher = COLUMN_NAME_PATTERN.matcher(errorMessage);
        return matcher.find() ? matcher.group(1) : null;
    }

    
    static String suggestSolution(String errorMessage) {
        if (errorMessage == null) {
            return "Check the row's data against the table's column types and constraints.";
        }
        String lower = errorMessage.toLowerCase(Locale.ROOT);
        if (lower.contains("does not allow nulls") || lower.contains("cannot insert the value null")
                || lower.contains("cannot be null")) {
            return "A required column is blank in this row — fill it in for every row and re-upload.";
        }
        if (lower.contains("cannot insert duplicate key") || lower.contains("violation of primary key")
                || lower.contains("violation of unique key") || lower.contains("unique index")) {
            return "This row's key already exists in the table — check for duplicate or already-imported values.";
        }
        if (lower.contains("foreign key constraint")) {
            return "This row references a value that doesn't exist in a related table — check for typos or add the referenced record first.";
        }
        if (lower.contains("truncat") || lower.contains("data too long")) {
            return "One of the values is too long for its column — shorten it or check the column's maximum length.";
        }
        if (lower.contains("conversion failed") || lower.contains("converting")
                || lower.contains("incorrect integer value") || lower.contains("incorrect decimal value")
                || lower.contains("incorrect date value")) {
            return "A value doesn't match the expected data type (e.g. text where a number or date was expected) — check the column formats.";
        }
        if (lower.contains("identity")) {
            return "This column is auto-generated by the database and shouldn't be given a value — remove it from the file.";
        }
        if (lower.contains("check constraint") || lower.contains("constraint") && lower.contains("violated")) {
            return "This row's value violates a validation rule on the table — verify the allowed values for this column.";
        }
        return "Check the row's data against the table's column types and constraints.";
    }

    
    static String rootCauseMessage(Throwable t) {
        Throwable cause = t;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause.getMessage() != null ? cause.getMessage() : t.getMessage();
    }
}
