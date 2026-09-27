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

/**
 * Stateless helpers shared by {@link ImportChunkRowProcessor} and the two run modes
 * ({@link ImportValidationRunner}, {@link ImportAtomicCommitRunner}): cell-value normalization/type
 * checking on the way in, and turning a raw database exception into a plain-language row error on the
 * way out. No instance state — every method is a pure function of its arguments, so this is a plain
 * static utility class rather than a Spring bean.
 */
final class ImportValueNormalizer {

    private ImportValueNormalizer() {
    }

    private static final Pattern COLUMN_NAME_PATTERN = Pattern.compile("column '([^']+)'", Pattern.CASE_INSENSITIVE);
    // Matches MySQL's FK-violation wording (error 1452): `Cannot add or update a child row: a foreign
    // key constraint fails (`db`.`table`, CONSTRAINT `FK_Name` FOREIGN KEY (`col`) REFERENCES
    // `parent` (`col`))` — checked before COLUMN_NAME_PATTERN so the failing constraint is identified
    // by name (see extractErrorColumn / TableAccessService#getForeignKeyReferences).
    private static final Pattern FK_CONSTRAINT_NAME_PATTERN =
            Pattern.compile("CONSTRAINT `([^`]+)` FOREIGN KEY", Pattern.CASE_INSENSITIVE);
    // Broader fallback for detecting an FK violation at all (see isForeignKeyViolation) even when the
    // constraint-name pattern above doesn't match — MySQL's wording always includes this phrase.
    private static final Pattern FK_VIOLATION_PHRASE_PATTERN =
            Pattern.compile("foreign key constraint", Pattern.CASE_INSENSITIVE);
    // Checked proactively (before ever reaching the database) so a bad value can be pinned to its
    // exact column — the database's own conversion-failure error text doesn't always name the
    // column, only the value and target type, so parsing that error after the fact can only fall
    // back to flagging the whole row. Date/datetime columns are deliberately left out of this
    // proactive check: normalizeDateText() already accepts a wide range of input formats, and a
    // stricter parse here risks rejecting a value the database itself would have accepted.
    private static final Set<String> INTEGER_COLUMN_TYPES = Set.of("int", "bigint", "smallint", "tinyint");
    private static final Set<String> DECIMAL_COLUMN_TYPES = Set.of("decimal", "numeric", "float", "real", "money", "smallmoney");
    private static final Set<String> BIT_COLUMN_TYPES = Set.of("bit");
    // Tried in order: ISO first (unambiguous), then day-first formats before month-first ones —
    // when a date is genuinely ambiguous (both parts <= 12) this project's files use day-first
    // (e.g. 28/07/2026 == 28 July 2026); when it's unambiguous (e.g. day > 12) only one format
    // ever parses successfully regardless of this ordering.
    // Patterns use "u" (proleptic year) rather than "y" (year-of-era): with ResolverStyle.STRICT,
    // "y" requires an era to resolve and silently fails on locales (e.g. en_IN) whose default
    // chronology doesn't supply one for a plain numeric year — "u" has no such ambiguity.
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

    /**
     * NOTE (2026-08-11): this is where date-format-on-insert already happens for CSV uploads —
     * converts a date written in any of the common file formats (MM/DD/YYYY, DD-MM-YYYY,
     * DD-MMM-YYYY, etc.) into ISO date text (YYYY-MM-DD) — the value's actual day,
     * month and year are preserved exactly, only the textual format changes. Falls back to
     * treating the value as a raw Excel date serial number (see {@link #parseExcelSerialDate})
     * before giving up — a date column whose source spreadsheet cell was never actually formatted
     * as a date in Excel loses that formatting entirely once exported to CSV (CSV carries no cell
     * formatting, only whatever the cell's underlying value is), leaving just the bare day-count
     * behind. Left untouched if neither approach recognizes it — the database's own validation
     * reports that case as before. (For .xlsx uploads, the equivalent conversion happens earlier,
     * at parse time — see ImportUploadFileParser.formatExcelDate().)
     */
    static String normalizeDateText(String raw) {
        String trimmed = raw.trim();
        for (DateTimeFormatter format : DATE_INPUT_FORMATS) {
            try {
                LocalDate parsed = LocalDate.parse(trimmed, format.withResolverStyle(ResolverStyle.STRICT));
                return parsed.format(DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (DateTimeParseException ignored) {
                // Try the next candidate format.
            }
        }
        LocalDate serialDate = parseExcelSerialDate(trimmed);
        if (serialDate != null) {
            return serialDate.format(DateTimeFormatter.ISO_LOCAL_DATE);
        }
        return raw;
    }

    // Excel represents dates as a day-count from this base (Dec 30, 1899 rather than Jan 1, 1900) —
    // the well-known off-by-one accounts for Excel's fictitious "Feb 29, 1900" bug and matches
    // Excel's own serial numbering exactly for every real-world date this ever needs to handle.
    private static final LocalDate EXCEL_SERIAL_DATE_EPOCH = LocalDate.of(1899, 12, 30);
    // A bare integer landing in a date column is only ever treated as a serial date if the result
    // is a plausible calendar year — otherwise an unrelated number that happens to land in a date
    // column (a genuine data-entry mistake, e.g. a batch quantity typed into the wrong cell) would
    // silently turn into a fabricated date instead of being correctly flagged as invalid.
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
            // Long.parseLong overflow, or plusDays() overflowing LocalDate's own range — either way,
            // not a usable date.
            return null;
        }
        int year = date.getYear();
        return year >= MIN_PLAUSIBLE_SERIAL_DATE_YEAR && year <= MAX_PLAUSIBLE_SERIAL_DATE_YEAR ? date : null;
    }

    /**
     * Checks one non-null cell value against its column's SQL type, returning a plain-language
     * reason (e.g. "expects a whole number") if it won't fit, or null if it's fine. Only covers
     * numeric/boolean types — date columns are left to the database (see the constants above).
     */
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

    /**
     * True when {@code errorMessage} is a FOREIGN KEY violation — the one error shape where
     * {@link #COLUMN_NAME_PATTERN} would name the wrong (referenced-table) column, so callers must
     * resolve the real local column via the constraint name instead (see
     * {@link #extractForeignKeyConstraintName} / {@code TableAccessService#getForeignKeyLocalColumns}).
     */
    static boolean isForeignKeyViolation(String errorMessage) {
        return errorMessage != null && (FK_CONSTRAINT_NAME_PATTERN.matcher(errorMessage).find()
                || FK_VIOLATION_PHRASE_PATTERN.matcher(errorMessage).find());
    }

    /** The named constraint from an FK-violation message (e.g. "FK_PrimarySales_Billto_SiteMaster"), or null. */
    static String extractForeignKeyConstraintName(String errorMessage) {
        if (errorMessage == null) {
            return null;
        }
        Matcher matcher = FK_CONSTRAINT_NAME_PATTERN.matcher(errorMessage);
        return matcher.find() ? matcher.group(1) : null;
    }

    /**
     * Only meaningful for NON-FK-violation messages — see {@link #isForeignKeyViolation}. For those
     * (NOT NULL, truncation, type conversion, etc.) MySQL's "column '...'" wording correctly
     * names the local column holding the bad value.
     */
    static String extractErrorColumn(String errorMessage) {
        if (errorMessage == null) {
            return null;
        }
        Matcher matcher = COLUMN_NAME_PATTERN.matcher(errorMessage);
        return matcher.find() ? matcher.group(1) : null;
    }

    /** Turns a raw database error into a plain-language, actionable suggestion for fixing the file. */
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

    /**
     * Spring's DataAccessException.getMessage() starts with the entire SQL statement text before
     * ever getting to the actual database error, so truncating that directly hides the useful
     * part. The root cause (the driver's own exception) has the concise, specific reason instead.
     */
    static String rootCauseMessage(Throwable t) {
        Throwable cause = t;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause.getMessage() != null ? cause.getMessage() : t.getMessage();
    }
}
