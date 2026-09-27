package com.houseofbeauty.controller.pages.dataupload;

import com.opencsv.CSVReader;
import com.opencsv.exceptions.CsvException;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.IntConsumer;
import java.util.regex.Pattern;

/**
 * Turns an uploaded CSV/XLSX file's raw bytes into headers + data rows, ready for
 * {@link ImportColumnValidator} and {@link com.houseofbeauty.service.dataupload.import_common.ImportProcessingService}.
 * Every method is a pure function of its arguments (no dependencies, no state), so this is a plain
 * static utility class rather than a Spring bean — used by {@link ImportSessionController} for
 * upload/preview/process/commit, all of which need the stored file re-parsed from scratch rather than
 * trusting anything cached from an earlier step.
 */
final class ImportUploadFileParser {

    private ImportUploadFileParser() {
    }

    // How often (in parsed data rows) a progress callback fires during upload parsing — see
    // ImportSessionController#runUploadJob. Frequent enough for a smooth-looking counter/ETA on a
    // multi-hundred-thousand-row file, infrequent enough that the callback itself (a volatile field
    // write) is never a measurable fraction of the parse's own per-row cost.
    private static final int PROGRESS_REPORT_INTERVAL = 200;

    record ParsedFile(List<String> headers, int totalRows) {
    }

    // One sheet in an uploaded workbook, reported by listDataSheets so a caller can ask the user
    // to choose explicitly rather than silently reading sheet 0 when more than one sheet actually
    // has data — see ImportSessionController#upload.
    record SheetInfo(int index, String name, int rowCount) {
    }

    // precisionRiskCells: 0-based row index (matching rows' own indices) -> column names whose
    // source cell may have already lost precision before this code ever saw the file. Two distinct
    // causes, one per file type: an XLSX numeric cell too large for exact double storage (see
    // isRiskyNumericCell), or a CSV cell whose text is already scientific notation with a mantissa
    // too short to cover its own exponent (see isRiskyScientificNotation) — e.g. "6.89E+11" only
    // gives 3 real digits for a 12-digit number, the other 9 are fabricated zero-padding, not
    // digits that were ever actually captured. Either way, the true original digits are gone from
    // the file before this code runs, so this can only warn, never recover the real value.
    record ParsedRows(List<String> headers, List<List<String>> rows,
                       Map<Integer, Set<String>> precisionRiskCells) {
    }

    static String extensionOf(String filename) {
        int dot = filename.lastIndexOf('.');
        return dot < 0 ? "" : filename.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    static ParsedFile parseFile(byte[] fileBytes, String extension, int sheetIndex) throws IOException {
        ParsedRows parsed = parseRows(fileBytes, extension, sheetIndex);
        return new ParsedFile(parsed.headers(), parsed.rows().size());
    }

    // Dispatches to the CSV or XLSX reader based on the stored file's extension. sheetIndex is
    // ignored for CSV (single-sheet by definition).
    static ParsedRows parseRows(byte[] fileBytes, String extension, int sheetIndex) throws IOException {
        return "csv".equals(extension) ? parseCsvRows(fileBytes, null) : parseXlsxRows(fileBytes, sheetIndex);
    }

    // Fast approximate total-row count for progress reporting during /upload — counts newline bytes
    // in the raw upload instead of doing a second full CSV parse just to know a total ahead of time.
    // Approximate (a quoted field containing a literal newline, or a missing trailing newline, can
    // throw it off by a line or two) but derived from the actual uploaded bytes rather than guessed —
    // good enough for a progress percentage, and parseCsvRows's own final callback (see
    // ImportSessionController#runUploadJob) corrects the total to the real row count once parsing
    // finishes either way.
    static int estimateCsvRowCount(byte[] fileBytes) {
        int count = 0;
        for (byte b : fileBytes) {
            if (b == '\n') {
                count++;
            }
        }
        if (fileBytes.length > 0 && fileBytes[fileBytes.length - 1] != '\n') {
            count++;
        }
        return Math.max(0, count - 1);
    }

    /**
     * Every sheet in an .xlsx workbook that has at least one non-blank data row beneath its header —
     * a sheet with no data rows (or none at all) is never worth asking the user about. Empty for CSV
     * (single-sheet by definition, nothing to choose between). Used by
     * {@code ImportSessionController#upload} to require an explicit {@code sheetIndex} choice
     * whenever more than one sheet qualifies, instead of silently reading sheet 0 — see the design
     * note on explicit sheet selection.
     */
    static List<SheetInfo> listDataSheets(byte[] fileBytes, String extension) throws IOException {
        if (!"xlsx".equals(extension)) {
            return List.of();
        }
        try (Workbook workbook = openXlsxWorkbook(fileBytes)) {
            return listDataSheets(workbook);
        }
    }

    // Opens the workbook once so a caller that needs both the sheet listing and the parsed rows (see
    // ImportSessionController#upload) can reuse the same in-memory Workbook instead of paying the full
    // WorkbookFactory.create() parse cost twice per upload.
    static Workbook openXlsxWorkbook(byte[] fileBytes) throws IOException {
        return WorkbookFactory.create(new ByteArrayInputStream(fileBytes));
    }

    static List<SheetInfo> listDataSheets(Workbook workbook) {
        List<SheetInfo> sheets = new ArrayList<>();
        for (int i = 0; i < workbook.getNumberOfSheets(); i++) {
            Sheet sheet = workbook.getSheetAt(i);
            int rowCount = countDataRows(sheet);
            if (rowCount > 0) {
                sheets.add(new SheetInfo(i, workbook.getSheetName(i), rowCount));
            }
        }
        return sheets;
    }

    private static int countDataRows(Sheet sheet) {
        int firstRowNum = sheet.getFirstRowNum();
        if (firstRowNum < 0) {
            return 0;
        }
        int count = 0;
        for (int r = firstRowNum + 1; r <= sheet.getLastRowNum(); r++) {
            Row row = sheet.getRow(r);
            if (row == null) {
                continue;
            }
            for (Cell cell : row) {
                if (cell != null && cell.getCellType() != CellType.BLANK && !cellToString(cell).trim().isEmpty()) {
                    count++;
                    break;
                }
            }
        }
        return count;
    }

    // Strips a leading UTF-8 BOM if present, skips blank lines, and normalizes scientific-notation
    // numbers in every data cell. CSVReader (unlike a hand-rolled line splitter) correctly handles a
    // quoted field that itself contains a newline, which a plain BufferedReader#readLine loop would
    // have split into two "lines" and mis-parsed.
    //
    // Reads row-by-row via readNext() (rather than the old readAll()-then-index approach) so a
    // non-null onRowParsed callback (see ImportSessionController#runUploadJob) can report real,
    // incremental progress during /upload — not needed by any other caller, which is why every other
    // call site keeps going through the no-callback parseRows(...) overload above.
    static ParsedRows parseCsvRows(byte[] fileBytes, IntConsumer onRowParsed) throws IOException {
        String content = new String(fileBytes, StandardCharsets.UTF_8);
        if (!content.isEmpty() && content.charAt(0) == '﻿') {
            content = content.substring(1);
        }

        List<String> headers = List.of();
        List<List<String>> rows = new ArrayList<>();
        Map<Integer, Set<String>> precisionRiskCells = new LinkedHashMap<>();
        try (CSVReader csvReader = new CSVReader(new StringReader(content))) {
            boolean sawHeaderRow = false;
            String[] line;
            while ((line = csvReader.readNext()) != null) {
                List<String> fields = trimFields(line);
                if (!sawHeaderRow) {
                    headers = fields;
                    sawHeaderRow = true;
                    continue;
                }
                if (isBlankRow(fields)) {
                    continue;
                }
                Set<String> riskyColumnsInRow = new LinkedHashSet<>();
                for (int c = 0; c < fields.size() && c < headers.size(); c++) {
                    String raw = fields.get(c);
                    if (isRiskyScientificNotation(raw)) {
                        riskyColumnsInRow.add(headers.get(c));
                    }
                    fields.set(c, normalizeScientificNotation(raw));
                }
                if (!riskyColumnsInRow.isEmpty()) {
                    precisionRiskCells.put(rows.size(), riskyColumnsInRow);
                }
                rows.add(fields);
                if (onRowParsed != null && rows.size() % PROGRESS_REPORT_INTERVAL == 0) {
                    onRowParsed.accept(rows.size());
                }
            }
        } catch (CsvException e) {
            throw new IOException("Malformed CSV file: " + e.getMessage(), e);
        }
        if (onRowParsed != null) {
            onRowParsed.accept(rows.size());
        }
        return new ParsedRows(headers, rows, precisionRiskCells);
    }

    private static List<String> trimFields(String[] fields) {
        List<String> result = new ArrayList<>(fields.length);
        for (String field : fields) {
            result.add(field == null ? "" : field.trim());
        }
        return result;
    }

    private static boolean isBlankRow(List<String> fields) {
        return fields.stream().allMatch(String::isEmpty);
    }

    // Reads the chosen sheet's header row plus every non-blank data row beneath it.
    private static ParsedRows parseXlsxRows(byte[] fileBytes, int sheetIndex) throws IOException {
        try (Workbook workbook = openXlsxWorkbook(fileBytes)) {
            return parseXlsxRows(workbook, sheetIndex);
        }
    }

    static ParsedRows parseXlsxRows(Workbook workbook, int sheetIndex) {
        return parseXlsxRows(workbook, sheetIndex, null);
    }

    // See the onRowParsed note on parseCsvRows above — same purpose, xlsx side.
    static ParsedRows parseXlsxRows(Workbook workbook, int sheetIndex, IntConsumer onRowParsed) {
        Sheet sheet = workbook.getSheetAt(sheetIndex);
        int firstRowNum = sheet.getFirstRowNum();
        Row headerRow = sheet.getRow(firstRowNum);
        List<String> headers = new ArrayList<>();
        if (headerRow != null) {
            for (Cell cell : headerRow) {
                headers.add(cellToString(cell).trim());
            }
        }

        List<List<String>> rows = new ArrayList<>();
        Map<Integer, Set<String>> precisionRiskCells = new LinkedHashMap<>();
        for (int r = firstRowNum + 1; r <= sheet.getLastRowNum(); r++) {
            Row dataRow = sheet.getRow(r);
            if (dataRow == null) {
                continue;
            }
            List<String> values = new ArrayList<>();
            Set<String> riskyColumnsInRow = new LinkedHashSet<>();
            boolean allBlank = true;
            for (int c = 0; c < headers.size(); c++) {
                Cell cell = dataRow.getCell(c);
                String value = cell == null ? "" : cellToString(cell).trim();
                if (!value.isEmpty()) {
                    allBlank = false;
                }
                if (cell != null && isRiskyNumericCell(cell)) {
                    riskyColumnsInRow.add(headers.get(c));
                }
                values.add(value);
            }
            if (!allBlank) {
                if (!riskyColumnsInRow.isEmpty()) {
                    precisionRiskCells.put(rows.size(), riskyColumnsInRow);
                }
                rows.add(values);
                if (onRowParsed != null && rows.size() % PROGRESS_REPORT_INTERVAL == 0) {
                    onRowParsed.accept(rows.size());
                }
            }
        }
        if (onRowParsed != null) {
            onRowParsed.accept(rows.size());
        }
        return new ParsedRows(headers, rows, precisionRiskCells);
    }

    private static final double MAX_SAFE_INTEGER_DOUBLE = 9_007_199_254_740_992d; // 2^53

    /**
     * Excel stores every number as a 64-bit double, which can only represent integers exactly up
     * to 2^53 (~15-16 significant digits) — past that, Excel has already silently rounded the value
     * before this code ever reads the file, so the original digits the user typed are unrecoverable.
     * Flags it here (proactively, before insert) rather than letting it land wrong in the database.
     */
    private static boolean isRiskyNumericCell(Cell cell) {
        CellType type = cell.getCellType();
        CellType effectiveType = type == CellType.FORMULA ? cell.getCachedFormulaResultType() : type;
        if (effectiveType != CellType.NUMERIC || DateUtil.isCellDateFormatted(cell)) {
            return false;
        }
        return Math.abs(cell.getNumericCellValue()) >= MAX_SAFE_INTEGER_DOUBLE;
    }

    // Renders any Excel cell (including formula results) as the plain text an import row expects.
    private static String cellToString(Cell cell) {
        return switch (cell.getCellType()) {
            case STRING -> cell.getStringCellValue();
            case NUMERIC -> DateUtil.isCellDateFormatted(cell)
                    ? formatExcelDate(cell.getLocalDateTimeCellValue())
                    : numericCellToPlainString(cell.getNumericCellValue());
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            case FORMULA -> switch (cell.getCachedFormulaResultType()) {
                case NUMERIC -> DateUtil.isCellDateFormatted(cell)
                        ? formatExcelDate(cell.getLocalDateTimeCellValue())
                        : numericCellToPlainString(cell.getNumericCellValue());
                case STRING -> cell.getStringCellValue();
                case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
                default -> cell.toString();
            };
            default -> cell.toString();
        };
    }

    private static final DateTimeFormatter EXCEL_ISO_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter EXCEL_ISO_DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * NOTE (2026-08-11): this is where date-format-on-insert already happens for .xlsx uploads
     * (CSV's equivalent is ImportValueNormalizer.normalizeDateText()). Excel stores dates as a
     * plain numeric day-count (e.g. 46200), with "this looks like a date" carried only in the
     * cell's display format — so reading it as a number without checking that format first (the
     * previous behavior here) silently inserted the raw serial number instead of the actual date.
     * Reading the cell as a date/time value and re-formatting as ISO (yyyy-MM-dd) text fixes that
     * regardless of how the source file's date column was formatted (MM/DD/YYYY, DD-MM-YYYY, etc.)
     * — the date itself is unchanged, only its text representation becomes DB-ready.
     */
    private static String formatExcelDate(LocalDateTime dateTime) {
        return dateTime.toLocalTime().equals(LocalTime.MIDNIGHT)
                ? dateTime.format(EXCEL_ISO_DATE)
                : dateTime.format(EXCEL_ISO_DATE_TIME);
    }

    /**
     * Excel stores every number as a double, and Java's default double-to-string conversion
     * switches to scientific notation (e.g. "1.23E8") once the magnitude crosses ~1e7 — silently
     * corrupting long IDs, phone numbers, and account numbers if that text were inserted as-is.
     * Routing through BigDecimal instead always yields the full, plain-digit decimal string.
     */
    static String numericCellToPlainString(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return String.valueOf(value);
        }
        return wholeNumberAwarePlainString(BigDecimal.valueOf(value));
    }

    private static final Pattern SCIENTIFIC_NOTATION_PATTERN =
            Pattern.compile("^[+-]?\\d+(\\.\\d+)?[eE][+-]?\\d+$");

    /**
     * Guards against files where the source spreadsheet had already collapsed a long number into
     * scientific-notation text (e.g. "1.23E+08") before being saved/exported as CSV — expands it
     * back to a plain decimal instead of storing the exponential text literally.
     */
    static String normalizeScientificNotation(String value) {
        if (value == null || value.isEmpty() || !SCIENTIFIC_NOTATION_PATTERN.matcher(value).matches()) {
            return value;
        }
        try {
            return wholeNumberAwarePlainString(new BigDecimal(value));
        } catch (NumberFormatException e) {
            return value;
        }
    }

    /**
     * True when a scientific-notation cell's mantissa has fewer explicit digits than its exponent
     * needs, meaning expanding it necessarily fabricates zero digits that were never actually
     * captured — e.g. "6.89E+11" (mantissa "689", 3 digits) expands to "689000000000" (12 digits);
     * the 9 trailing zeros are padding forced by the exponent, not real digits, so the true
     * 12-digit number (a barcode, phone number, article code, etc.) is unrecoverable from this
     * file — whoever created it already lost that precision, most likely by letting Excel
     * auto-format a long number as scientific notation before saving/exporting as CSV.
     * <p>
     * Detected via {@link BigDecimal#scale()}: parsing scientific notation text into a BigDecimal
     * yields a negative scale exactly when the exponent shifts the mantissa past its own explicit
     * decimal digits (needing zero-padding to become a whole number) — confirmed against this
     * class's own worked example in {@link #wholeNumberAwarePlainString}: "2.637900E+5" parses to
     * scale +1 (the mantissa's own trailing "00" already covers it, nothing fabricated, not
     * flagged), while "6.89E+11" parses to scale -9 (9 fabricated digits, flagged).
     */
    private static boolean isRiskyScientificNotation(String value) {
        if (value == null || value.isEmpty() || !SCIENTIFIC_NOTATION_PATTERN.matcher(value).matches()) {
            return false;
        }
        try {
            return new BigDecimal(value).scale() < 0;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * A scientific-notation literal's mantissa digit count and exponent don't always cancel out to
     * exactly zero even when the number itself is mathematically a whole one (e.g. "2.637900E+5" —
     * an article code or phone number Excel collapsed into scientific notation — parses to a
     * BigDecimal with scale 1, so a plain toPlainString() would wrongly render it as "263790.0").
     * Stripping trailing zeros first correctly recognizes it as whole and renders the clean integer
     * digits instead; a genuinely fractional value (e.g. a real decimal money amount) is left as a
     * plain decimal string, unrounded and untouched.
     */
    private static String wholeNumberAwarePlainString(BigDecimal decimal) {
        BigDecimal stripped = decimal.stripTrailingZeros();
        return stripped.scale() <= 0 ? stripped.toBigInteger().toString() : decimal.toPlainString();
    }
}
