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

/**
 * Turns {@link ImportProcessingService} results and {@link ImportSession} rows into the two external
 * shapes {@link ImportSessionController} hands back: typed row/error DTOs (see
 * {@code com.houseofbeauty.dto.dataupload}) for the Preview/Commit API responses, and the downloadable
 * "Upload History" .xlsx workbook. No dependencies, no state — a plain static utility class.
 */
final class ImportSessionResponseBuilder {

    private ImportSessionResponseBuilder() {
    }

    static RowResultResponse toRowResponse(ImportProcessingService.RowResult r) {
        return new RowResultResponse(r.rowNumber(), r.status().name(), r.data(), r.errorColumn(), r.errorMessage(),
                r.solution());
    }

    /**
     * The UI-facing "first 5, then the last" capped error display for a validation attempt that hit
     * its table's invalid-row budget (see {@link com.houseofbeauty.service.dataupload.import_common.TableImportRules#invalidRowBudget}).
     * Row order — not detection/completion order, which under parallel chunk validation isn't
     * necessarily the same thing — is what determines which row is "the last": {@link ImportProcessingService#run}
     * guarantees at most that table's budget worth of rows are ever admitted, so sorting the invalid/
     * duplicate rows by rowNumber and taking the last one is exactly "the row that tripped the cap"
     * whenever chunks were validated in row order, and a well-defined, deterministic choice even in
     * the rare case a later chunk's row happened to reserve its slot before an earlier chunk's did.
     * {@code invalidRows.size()} itself IS the effective budget whenever the cap was actually reached
     * (the engine never admits more), so no separate budget value needs to be threaded in here.
     *
     * <p>Only meaningful when {@code result.invalidLimitReached()} is true — callers should treat an
     * empty {@code displayedInvalidRows} / null {@code finalInvalidRow} as "not applicable" otherwise.
     */
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

    // Renders the filtered/sorted session list as an .xlsx workbook for ImportSessionController#exportLog.
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
                // originalFilename and message both ultimately trace back to what an uploader supplied
                // (the file's own name, and error text that can echo back a bad cell's literal value) —
                // sanitized so a crafted string like "=cmd|'/c calc'!A1" lands as inert text instead of
                // a formula Excel would offer to evaluate when someone opens this export.
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

    // Renders a completed /full-scan's entire row set — valid and invalid rows together — as one
    // .xlsx workbook for ImportSessionController#downloadFullScan. Columns are exactly the uploaded
    // file's own real headers, no added Status column: per explicit request, a non-VALID row's own
    // offending cell (its real errorColumn — the same single cell DataUploadPage.js's own
    // buildRowTr highlights in the on-screen review table) is the ONLY visual marker, its font
    // colored red; every other cell (including every cell of an otherwise-valid row) renders as
    // plain default-colored text.
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

    // Formula-injection guard: a cell value that would open as a formula in Excel (starts with
    // = + - @, or a leading tab/carriage-return trick) gets a leading apostrophe, which every
    // spreadsheet application treats as "force this to display as literal text" and never itself
    // shows in the rendered cell. Only touches values that trace back to user-supplied content
    // (an uploaded file's own name, or error text that can echo a bad cell's value) — never the
    // app's own fixed strings (table key, status).
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
