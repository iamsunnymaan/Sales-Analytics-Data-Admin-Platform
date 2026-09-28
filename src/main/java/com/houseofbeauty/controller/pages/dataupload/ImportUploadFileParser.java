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

final class ImportUploadFileParser {

    private ImportUploadFileParser() {
    }

    private static final int PROGRESS_REPORT_INTERVAL = 200;

    record ParsedFile(List<String> headers, int totalRows) {
    }

    record SheetInfo(int index, String name, int rowCount) {
    }

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

    static ParsedRows parseRows(byte[] fileBytes, String extension, int sheetIndex) throws IOException {
        return "csv".equals(extension) ? parseCsvRows(fileBytes, null) : parseXlsxRows(fileBytes, sheetIndex);
    }

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

    static List<SheetInfo> listDataSheets(byte[] fileBytes, String extension) throws IOException {
        if (!"xlsx".equals(extension)) {
            return List.of();
        }
        try (Workbook workbook = openXlsxWorkbook(fileBytes)) {
            return listDataSheets(workbook);
        }
    }

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

    private static ParsedRows parseXlsxRows(byte[] fileBytes, int sheetIndex) throws IOException {
        try (Workbook workbook = openXlsxWorkbook(fileBytes)) {
            return parseXlsxRows(workbook, sheetIndex);
        }
    }

    static ParsedRows parseXlsxRows(Workbook workbook, int sheetIndex) {
        return parseXlsxRows(workbook, sheetIndex, null);
    }

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

    private static final double MAX_SAFE_INTEGER_DOUBLE = 9_007_199_254_740_992d;

    private static boolean isRiskyNumericCell(Cell cell) {
        CellType type = cell.getCellType();
        CellType effectiveType = type == CellType.FORMULA ? cell.getCachedFormulaResultType() : type;
        if (effectiveType != CellType.NUMERIC || DateUtil.isCellDateFormatted(cell)) {
            return false;
        }
        return Math.abs(cell.getNumericCellValue()) >= MAX_SAFE_INTEGER_DOUBLE;
    }

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

    private static String formatExcelDate(LocalDateTime dateTime) {
        return dateTime.toLocalTime().equals(LocalTime.MIDNIGHT)
                ? dateTime.format(EXCEL_ISO_DATE)
                : dateTime.format(EXCEL_ISO_DATE_TIME);
    }

    static String numericCellToPlainString(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return String.valueOf(value);
        }
        return wholeNumberAwarePlainString(BigDecimal.valueOf(value));
    }

    private static final Pattern SCIENTIFIC_NOTATION_PATTERN =
            Pattern.compile("^[+-]?\\d+(\\.\\d+)?[eE][+-]?\\d+$");

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

    private static String wholeNumberAwarePlainString(BigDecimal decimal) {
        BigDecimal stripped = decimal.stripTrailingZeros();
        return stripped.scale() <= 0 ? stripped.toBigInteger().toString() : decimal.toPlainString();
    }
}
