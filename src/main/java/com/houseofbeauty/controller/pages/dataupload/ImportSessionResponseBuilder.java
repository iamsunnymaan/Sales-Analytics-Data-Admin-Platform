package com.houseofbeauty.controller.pages.dataupload;

import com.houseofbeauty.dto.dataupload.response.RowResultResponse;
import com.houseofbeauty.dto.dataupload.response.ValidationResultResponse;
import com.houseofbeauty.model.ImportSession;
import com.houseofbeauty.service.dataupload.import_common.ImportLimits;
import com.houseofbeauty.service.dataupload.import_common.ImportProcessingService;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.IOException;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

final class ImportSessionResponseBuilder {

    private ImportSessionResponseBuilder() {
    }

    static RowResultResponse toRowResponse(ImportProcessingService.RowResult r) {
        return new RowResultResponse(r.rowNumber(), r.status().name(), r.data(), r.errorColumn(), r.errorMessage(),
                r.solution());
    }

    record CappedErrorInfo(List<RowResultResponse> displayedInvalidRows, RowResultResponse finalInvalidRow,
                            String message) {
    }

    static CappedErrorInfo buildCappedErrorInfo(ImportProcessingService.ImportRunResult result) {
        List<ImportProcessingService.RowResult> invalidRows = result.rowResults().stream()
                .filter(r -> r.status() != ImportProcessingService.RowStatus.VALID)
                .sorted(Comparator.comparingInt(ImportProcessingService.RowResult::rowNumber))
                .toList();

        List<RowResultResponse> leading = invalidRows.stream()
                .limit(ImportLimits.DISPLAYED_LEADING_ERRORS)
                .map(ImportSessionResponseBuilder::toRowResponse)
                .toList();
        RowResultResponse finalRow = !invalidRows.isEmpty()
                ? toRowResponse(invalidRows.get(invalidRows.size() - 1))
                : null;

        int count = invalidRows.size();
        return new CappedErrorInfo(leading, finalRow, count + (count == 1 ? " invalid row was" : " invalid rows were")
                + " detected. Validation stopped and no data was imported. "
                + "Please correct these issues in the Excel file and upload it again.");
    }

    static void writeHistoryWorkbook(List<ImportSession> sessions, HttpServletResponse response, String filename)
            throws IOException {
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");

        String[] headers = {"File", "Table", "Status", "Total Rows", "Valid Rows", "Error Rows",
                "Duplicate Rows", "Inserted Rows", "Uploaded At", "Committed At", "Message"};
        DateTimeFormatter timestampFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("Upload History");
            Row headerRow = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                headerRow.createCell(i).setCellValue(headers[i]);
            }

            int rowIndex = 1;
            for (ImportSession session : sessions) {
                Row row = sheet.createRow(rowIndex++);

                row.createCell(0).setCellValue(sanitizeForExport(session.getOriginalFilename()));
                row.createCell(1).setCellValue(session.getTableKey());
                row.createCell(2).setCellValue(session.getStatus());
                setNullableInt(row, 3, session.getTotalRows());
                setNullableInt(row, 4, session.getValidRows());
                setNullableInt(row, 5, session.getErrorRows());
                setNullableInt(row, 6, session.getDuplicateRows());
                setNullableInt(row, 7, session.getInsertedRows());
                row.createCell(8).setCellValue(
                        session.getCreatedAt() != null ? timestampFormat.format(session.getCreatedAt()) : "");
                row.createCell(9).setCellValue(
                        session.getCommittedAt() != null ? timestampFormat.format(session.getCommittedAt()) : "");
                row.createCell(10).setCellValue(sanitizeForExport(session.getMessage()));
            }

            for (int i = 0; i < headers.length; i++) {
                sheet.autoSizeColumn(i);
            }

            workbook.write(response.getOutputStream());
        }
    }

    static void writeFullDatasetWorkbook(ValidationResultResponse result, HttpServletResponse response, String filename)
            throws IOException {
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");

        List<String> headers = result.headers() != null ? result.headers() : List.of();

        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("Data");

            Font redFont = workbook.createFont();
            redFont.setColor(IndexedColors.RED.getIndex());
            CellStyle invalidCellStyle = workbook.createCellStyle();
            invalidCellStyle.setFont(redFont);

            Row headerRow = sheet.createRow(0);
            for (int i = 0; i < headers.size(); i++) {
                headerRow.createCell(i).setCellValue(headers.get(i));
            }

            int rowIndex = 1;
            for (RowResultResponse row : result.rows()) {
                Row sheetRow = sheet.createRow(rowIndex++);
                boolean isBadRow = !"VALID".equals(row.status());
                String errorColumn = row.errorColumn();
                Map<String, Object> data = row.data();
                for (int i = 0; i < headers.size(); i++) {
                    String header = headers.get(i);
                    Object value = data != null ? data.get(header) : null;
                    Cell cell = sheetRow.createCell(i);
                    cell.setCellValue(sanitizeForExport(value == null ? "—" : value.toString()));
                    if (isBadRow && errorColumn != null && errorColumn.equalsIgnoreCase(header)) {
                        cell.setCellStyle(invalidCellStyle);
                    }
                }
            }

            for (int i = 0; i < headers.size(); i++) {
                sheet.autoSizeColumn(i);
            }

            workbook.write(response.getOutputStream());
        }
    }

    private static String sanitizeForExport(String value) {
        if (value == null) {
            return "";
        }
        if (!value.isEmpty()) {
            char first = value.charAt(0);
            if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
                return "'" + value;
            }
        }
        return value;
    }

    private static void setNullableInt(Row row, int index, Integer value) {
        if (value != null) {
            row.createCell(index).setCellValue(value);
        }
    }
}
