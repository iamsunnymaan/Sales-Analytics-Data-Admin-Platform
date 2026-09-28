package com.houseofbeauty.controller.pages.dataupload;

import com.houseofbeauty.controller.common.BaseCrudController;
import com.houseofbeauty.dto.dataupload.response.CancelResponse;
import com.houseofbeauty.dto.dataupload.response.CommitResultResponse;
import com.houseofbeauty.dto.dataupload.response.CommitStartedResponse;
import com.houseofbeauty.dto.dataupload.response.CommitStatusResponse;
import com.houseofbeauty.dto.dataupload.response.ErrorDetail;
import com.houseofbeauty.dto.dataupload.response.FilePreviewResponse;
import com.houseofbeauty.dto.dataupload.response.ImportProgressEvent;
import com.houseofbeauty.dto.dataupload.response.ProcessStartedResponse;
import com.houseofbeauty.dto.dataupload.response.ProcessStatusResponse;
import com.houseofbeauty.dto.dataupload.response.RowResultResponse;
import com.houseofbeauty.dto.dataupload.response.UploadStartedResponse;
import com.houseofbeauty.dto.dataupload.response.UploadStatusResponse;
import com.houseofbeauty.dto.dataupload.response.ValidationResultResponse;
import com.houseofbeauty.model.ImportSession;
import com.houseofbeauty.model.ImportSessionStatus;
import com.houseofbeauty.repository.ImportSessionRepository;
import com.houseofbeauty.security.RequirePermission;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import com.houseofbeauty.service.dataupload.import_common.ImportFileSecurityScanner;
import com.houseofbeauty.service.dataupload.import_common.ImportLimits;
import com.houseofbeauty.service.dataupload.import_common.ImportProcessingService;
import com.houseofbeauty.service.common.TableAccessService;
import com.houseofbeauty.service.monitoring.MonitoringAuditService;
import jakarta.persistence.EntityNotFoundException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.apache.poi.ss.usermodel.Workbook;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/import-sessions")
@RequirePermission("page:data-upload")
public class
ImportSessionController extends BaseCrudController<ImportSession, String> {

    private static final Set<String> SUPPORTED_EXTENSIONS = Set.of("csv", "xlsx");
    private static final int PREVIEW_ROW_CAP = 20_000;
    private static final int MAX_ERROR_DETAILS = 5_000;

    private static final int DUPLICATE_CHECK_WINDOW_DAYS = 30;

    private final ImportSessionRepository importSessionRepository;
    private final TableAccessService tableAccessService;
    private final ImportProcessingService importProcessingService;
    private final Path uploadDir;
    private final TaskExecutor taskExecutor;
    private final ImportColumnValidator columnValidator;
    private final ImportProcessJobTracker jobTracker;
    private final ImportUploadJobTracker uploadJobTracker;
    private final ImportSseEmitterRegistry sseRegistry;
    private final MonitoringAuditService monitoringAuditService;

    public ImportSessionController(ImportSessionRepository repository, TableAccessService tableAccessService,
                                    ImportProcessingService importProcessingService,
                                    @Value("${app.upload.dir:uploads}") String uploadDir,
                                    @Qualifier("importChunkExecutor") TaskExecutor taskExecutor,
                                    MonitoringAuditService monitoringAuditService) {
        super(repository);
        this.importSessionRepository = repository;
        this.tableAccessService = tableAccessService;
        this.importProcessingService = importProcessingService;
        this.uploadDir = Paths.get(uploadDir).toAbsolutePath().normalize();
        this.taskExecutor = taskExecutor;
        this.columnValidator = new ImportColumnValidator(tableAccessService, importProcessingService);
        this.jobTracker = new ImportProcessJobTracker();
        this.uploadJobTracker = new ImportUploadJobTracker();
        this.sseRegistry = new ImportSseEmitterRegistry();
        this.monitoringAuditService = monitoringAuditService;
    }

    @PostMapping("/upload")
    public UploadStartedResponse upload(@RequestParam("tableKey") String tableKey,
                                         @RequestParam("file") MultipartFile file,
                                         @RequestParam(value = "sheetIndex", required = false) Integer sheetIndex,
                                         HttpServletRequest request) throws IOException {

        HttpSession session = request.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;
        String ipAddress = request.getRemoteAddr();

        if (file.isEmpty()) {
            recordUpload(authUser, ipAddress, "(no file)", tableKey, false, "No file chosen.");
            throw new IllegalArgumentException("Choose a file to upload.");
        }
        String table = tableAccessService.validateTable(tableKey);

        String originalFilename = file.getOriginalFilename() != null ? file.getOriginalFilename() : "upload";
        String extension = ImportUploadFileParser.extensionOf(originalFilename);
        if (!SUPPORTED_EXTENSIONS.contains(extension)) {
            String shown = extension.isBlank() ? originalFilename : "." + extension;
            recordUpload(authUser, ipAddress, originalFilename, table, false,
                    "Unsupported file type '" + shown + "'. Only .csv and .xlsx files are supported.");
            throw new IllegalArgumentException(
                    "Unsupported file type '" + shown + "'. Only .csv and .xlsx files are supported.");
        }

        byte[] fileBytes = file.getBytes();

        String uploadId = UUID.randomUUID().toString();
        ImportUploadJobTracker.UploadJob job = uploadJobTracker.start(uploadId);
        taskExecutor.execute(() -> runUploadJob(uploadId, fileBytes, extension, originalFilename, table, sheetIndex,
                job, authUser, ipAddress));
        return new UploadStartedResponse(true, uploadId);
    }

    private void recordUpload(AuthenticatedUser authUser, String ipAddress, String fileName, String tableKey,
                               boolean success, String failureReason) {
        if (authUser == null) {
            return;
        }
        monitoringAuditService.recordUpload(authUser.getUserId(), authUser.getUsername(), ipAddress,
                fileName, tableKey, success, failureReason);
    }

    @GetMapping("/upload/{uploadId}/status")
    public UploadStatusResponse uploadStatus(@PathVariable String uploadId) {
        return uploadJobTracker.statusResponse(uploadId);
    }

    private void runUploadJob(String uploadId, byte[] fileBytes, String extension, String originalFilename,
                               String table, Integer requestedSheetIndex, ImportUploadJobTracker.UploadJob job,
                               AuthenticatedUser authUser, String ipAddress) {
        long startedAt = System.currentTimeMillis();
        try {
            ImportFileSecurityScanner.scan(fileBytes, extension);

            ImportUploadFileParser.ParsedRows parsedRows;
            int resolvedSheetIndex;
            if ("xlsx".equals(extension)) {
                try (Workbook workbook = ImportUploadFileParser.openXlsxWorkbook(fileBytes)) {
                    List<ImportUploadFileParser.SheetInfo> dataSheets = ImportUploadFileParser.listDataSheets(workbook);
                    resolvedSheetIndex = resolveSheetIndex(dataSheets, requestedSheetIndex);
                    job.totalRows = dataSheets.stream()
                            .filter(s -> s.index() == resolvedSheetIndex)
                            .findFirst()
                            .map(ImportUploadFileParser.SheetInfo::rowCount)
                            .orElse(0);
                    parsedRows = ImportUploadFileParser.parseXlsxRows(workbook, resolvedSheetIndex,
                            processed -> {
                                job.processedRows = processed;
                                pushProgressEvent(uploadId, "UPLOAD", startedAt, processed, job.totalRows, 0, 0, 0);
                            });
                }
            } else {
                resolvedSheetIndex = 0;
                job.totalRows = ImportUploadFileParser.estimateCsvRowCount(fileBytes);
                parsedRows = ImportUploadFileParser.parseCsvRows(fileBytes, processed -> {
                    job.processedRows = processed;
                    pushProgressEvent(uploadId, "UPLOAD", startedAt, processed, job.totalRows, 0, 0, 0);
                });
            }
            job.processedRows = parsedRows.rows().size();
            job.totalRows = Math.max(job.totalRows, job.processedRows);

            columnValidator.validate(table, parsedRows.headers());

            String checksum = ImportUploadMetadata.sha256Hex(fileBytes);
            String duplicateWarning = findRecentDuplicateWarning(table, checksum);

            Files.createDirectories(uploadDir);
            Path storedPath = uploadDir.resolve(uploadId + "." + extension);
            Files.write(storedPath, fileBytes);

            ImportSession session = new ImportSession();
            session.setId(uploadId);
            session.setTableKey(table);
            session.setOriginalFilename(originalFilename);
            session.setStoredPath(storedPath.toString());
            session.setFileSize(fileBytes.length);
            session.setFileType(extension);
            session.setStatus(ImportSessionStatus.UPLOADED.value());
            session.setTotalRows(parsedRows.rows().size());
            session.setValidRows(0);
            session.setErrorRows(0);
            session.setDuplicateRows(0);
            session.setInsertedRows(0);
            session.setCreatedAt(LocalDateTime.now());
            session.setMappingJson(new ImportUploadMetadata(checksum, resolvedSheetIndex).toJson());

            ImportSession saved = importSessionRepository.save(session);
            saved.setDuplicateWarning(duplicateWarning);

            job.result = saved;
            job.status = "DONE";
            recordUpload(authUser, ipAddress, originalFilename, table, true, null);
        } catch (Exception e) {
            job.errorMessage = e.getMessage() != null ? e.getMessage() : "Upload failed unexpectedly.";
            job.status = "ERROR";
            recordUpload(authUser, ipAddress, originalFilename, table, false, job.errorMessage);
        } finally {
            sseRegistry.push(uploadId, "done", Map.of("status", job.status));
            sseRegistry.complete(uploadId);
        }
    }

    private int resolveSheetIndex(List<ImportUploadFileParser.SheetInfo> dataSheets, Integer requestedSheetIndex) {
        if (dataSheets.size() <= 1) {
            return dataSheets.isEmpty() ? 0 : dataSheets.get(0).index();
        }
        if (requestedSheetIndex != null) {
            boolean valid = dataSheets.stream().anyMatch(s -> s.index() == requestedSheetIndex);
            if (!valid) {
                throw new IllegalArgumentException("sheetIndex " + requestedSheetIndex + " has no data in this workbook.");
            }
            return requestedSheetIndex;
        }
        String options = dataSheets.stream()
                .map(s -> s.index() + ":" + s.name() + " (" + s.rowCount() + " rows)")
                .collect(Collectors.joining(", "));
        throw new IllegalArgumentException(
                "This workbook has more than one sheet with data — choose one and re-upload with that sheetIndex: "
                        + options);
    }

    private String findRecentDuplicateWarning(String table, String checksum) {
        LocalDateTime since = LocalDateTime.now().minusDays(DUPLICATE_CHECK_WINDOW_DAYS);
        return importSessionRepository.findAll().stream()
                .filter(s -> table.equalsIgnoreCase(s.getTableKey()))
                .filter(s -> s.getCreatedAt() != null && s.getCreatedAt().isAfter(since))
                .filter(s -> checksum.equals(ImportUploadMetadata.fromJson(s.getMappingJson()).fileChecksum()))
                .max(Comparator.comparing(ImportSession::getCreatedAt))
                .map(prior -> "This exact file was already uploaded to " + table + " as \""
                        + prior.getOriginalFilename() + "\" on " + prior.getCreatedAt().toLocalDate()
                        + " (status: " + prior.getStatus() + "). Continuing will validate/import it again.")
                .orElse(null);
    }

    @GetMapping("/{id}/events")
    public SseEmitter events(@PathVariable String id) {
        return sseRegistry.register(id);
    }

    @PostMapping("/{id}/process")
    public ProcessStartedResponse process(@PathVariable String id) {
        ImportSession session = findSession(id);
        requireNotYetImported(session);
        if (!jobTracker.tryAcquirePhase(id, "VALIDATING")) {
            throw new IllegalStateException("This upload is already being validated.");
        }

        String priorStatus = session.getStatus();
        ImportProcessJobTracker.ProcessJob job = jobTracker.start(id, session.getTotalRows(), ImportLimits.MAX_PARALLEL_CHUNKS);
        taskExecutor.execute(() -> runProcessJob(session, job, priorStatus));

        return new ProcessStartedResponse(true, session.getTotalRows());
    }

    @PostMapping("/{id}/cancel")
    public CancelResponse cancel(@PathVariable String id) {
        jobTracker.cancel(id);
        return new CancelResponse(true);
    }

    private void runProcessJob(ImportSession session, ImportProcessJobTracker.ProcessJob job, String priorStatus) {
        long startedAt = System.currentTimeMillis();

        session.setStatus(ImportSessionStatus.VALIDATING.value());
        importSessionRepository.save(session);
        try {
            try {
                ImportUploadFileParser.ParsedRows parsedRows = readRows(session);
                ImportProcessingService.ImportRunResult result = importProcessingService.run(
                        session.getTableKey(), parsedRows.headers(), parsedRows.rows(), true, parsedRows.precisionRiskCells(),
                        (processedRows, totalRows, insertedSoFar, duplicatesSoFar, errorsSoFar) -> {
                            job.processedRows = processedRows;
                            job.totalRows = totalRows;
                            job.insertedSoFar = insertedSoFar;
                            job.duplicatesSoFar = duplicatesSoFar;
                            job.errorsSoFar = errorsSoFar;
                            pushProgressEvent(session.getId(), "VALIDATE", startedAt, processedRows, totalRows,
                                    insertedSoFar, duplicatesSoFar, errorsSoFar);
                        },
                        () -> jobTracker.isCancelled(session.getId()),
                        (chunkIndex, chunkStatus, rowsDone, rowsTotal) -> updateChunkSlot(job.chunks, chunkIndex, chunkStatus, rowsDone),
                        newRowResults -> newRowResults.stream().map(ImportSessionResponseBuilder::toRowResponse)
                                .forEach(job.liveInvalidRows::add));

                if (result.cancelled()) {

                    session.setStatus(priorStatus);
                    importSessionRepository.save(session);
                    job.status = "CANCELLED";
                    return;
                }

                session.setStatus(result.invalidLimitReached()
                        ? ImportSessionStatus.FAILED.value()
                        : ImportSessionStatus.VALIDATED.value());
                importSessionRepository.save(session);

                List<RowResultResponse> rows = result.rowResults().stream()
                        .limit(PREVIEW_ROW_CAP)
                        .map(ImportSessionResponseBuilder::toRowResponse)
                        .toList();
                ImportSessionResponseBuilder.CappedErrorInfo cappedInfo = result.invalidLimitReached()
                        ? ImportSessionResponseBuilder.buildCappedErrorInfo(result)
                        : new ImportSessionResponseBuilder.CappedErrorInfo(List.of(), null, null);

                job.result = new ValidationResultResponse(session.getId(), session.getTableKey(),
                        session.getOriginalFilename(), result.totalRows(), result.inserted(), result.errors(),
                        result.duplicates(), result.effectiveHeaders(), rows, result.invalidLimitReached(),
                        cappedInfo.displayedInvalidRows(), cappedInfo.finalInvalidRow(), cappedInfo.message());
                job.status = "DONE";
            } catch (Exception e) {

                if (!"CANCELLED".equals(job.status)) {
                    job.errorMessage = e.getMessage() != null ? e.getMessage() : "Validation failed unexpectedly.";
                    job.status = "ERROR";
                }

                session.setStatus(priorStatus);
                importSessionRepository.save(session);
            }
        } finally {

            jobTracker.releasePhase(session.getId());

            sseRegistry.push(session.getId(), "done", Map.of("status", job.status));
            sseRegistry.complete(session.getId());
        }
    }

    private void updateChunkSlot(List<ImportProcessJobTracker.ChunkSlot> chunks, int chunkIndex, String status,
                                  int rowsDone) {
        if (chunkIndex < 0 || chunkIndex >= chunks.size()) {
            return;
        }
        ImportProcessJobTracker.ChunkSlot slot = chunks.get(chunkIndex);
        slot.status = status;
        slot.rowsDone = rowsDone;
    }

    @GetMapping("/{id}/process/status")
    public ProcessStatusResponse processStatus(@PathVariable String id) {
        return jobTracker.statusResponse(id);
    }

    @PostMapping("/{id}/full-scan")
    public ProcessStartedResponse fullScan(@PathVariable String id) {
        ImportSession session = findSession(id);
        ImportProcessJobTracker.ProcessJob job = jobTracker.startFullScan(id, session.getTotalRows(),
                ImportLimits.MAX_PARALLEL_CHUNKS);
        taskExecutor.execute(() -> runFullScanJob(session, job));
        return new ProcessStartedResponse(true, session.getTotalRows());
    }

    @GetMapping("/{id}/full-scan/status")
    public ProcessStatusResponse fullScanStatus(@PathVariable String id) {
        return jobTracker.fullScanStatusResponse(id);
    }

    @GetMapping("/{id}/full-scan/download")
    public void downloadFullScan(@PathVariable String id, HttpServletResponse response) throws IOException {
        ImportSession session = findSession(id);
        ValidationResultResponse result = jobTracker.fullScanResult(id);
        if (result == null) {
            throw new IllegalStateException("No completed scan available for this upload yet — try again.");
        }
        ImportSessionResponseBuilder.writeFullDatasetWorkbook(result, response, session.getTableKey() + "_full_dataset.xlsx");
    }

    private void runFullScanJob(ImportSession session, ImportProcessJobTracker.ProcessJob job) {
        try {
            ImportUploadFileParser.ParsedRows parsedRows = readRows(session);
            ImportProcessingService.ImportRunResult result = importProcessingService.run(
                    session.getTableKey(), parsedRows.headers(), parsedRows.rows(), true, parsedRows.precisionRiskCells(),
                    (processedRows, totalRows, insertedSoFar, duplicatesSoFar, errorsSoFar) -> {
                        job.processedRows = processedRows;
                        job.totalRows = totalRows;
                        job.insertedSoFar = insertedSoFar;
                        job.duplicatesSoFar = duplicatesSoFar;
                        job.errorsSoFar = errorsSoFar;
                    },
                    null,
                    (chunkIndex, chunkStatus, rowsDone, rowsTotal) -> updateChunkSlot(job.chunks, chunkIndex, chunkStatus, rowsDone),
                    newRowResults -> newRowResults.stream().map(ImportSessionResponseBuilder::toRowResponse)
                            .forEach(job.liveInvalidRows::add),
                    ImportLimits.FULL_SCAN_ROW_BUDGET);

            List<RowResultResponse> rows = result.rowResults().stream()
                    .map(ImportSessionResponseBuilder::toRowResponse)
                    .toList();
            job.result = new ValidationResultResponse(session.getId(), session.getTableKey(),
                    session.getOriginalFilename(), result.totalRows(), result.inserted(), result.errors(),
                    result.duplicates(), result.effectiveHeaders(), rows, false, List.of(), null, null);
            job.status = "DONE";
        } catch (Exception e) {
            job.errorMessage = e.getMessage() != null ? e.getMessage() : "Full scan failed unexpectedly.";
            job.status = "ERROR";
        }
    }

    @PostMapping("/{id}/commit")
    @RequirePermission("page:data-upload.upload-verify")
    public CommitStartedResponse commit(@PathVariable String id) {
        ImportSession session = findSession(id);
        requireValidatedForCommit(session);
        if (!jobTracker.tryAcquirePhase(id, "COMMITTING")) {
            throw new IllegalStateException("This upload is already being imported.");
        }
        jobTracker.clearCancellation(id);

        String priorStatus = session.getStatus();

        ImportProcessJobTracker.CommitJob job = jobTracker.startCommit(id, session.getTotalRows(), 1);
        taskExecutor.execute(() -> runCommitJob(session, job, priorStatus));

        return new CommitStartedResponse(true, session.getTotalRows());
    }

    @GetMapping("/{id}/commit/status")
    public CommitStatusResponse commitStatus(@PathVariable String id) {
        return jobTracker.commitStatusResponse(id);
    }

    private void runCommitJob(ImportSession session, ImportProcessJobTracker.CommitJob job, String priorStatus) {

        session.setStatus(ImportSessionStatus.COMMITTING.value());
        importSessionRepository.save(session);
        try {
            try {
                long startedAt = System.currentTimeMillis();
                ImportUploadFileParser.ParsedRows parsedRows = readRows(session);
                ImportProcessingService.ImportRunResult result = importProcessingService.run(
                        session.getTableKey(), parsedRows.headers(), parsedRows.rows(), false, parsedRows.precisionRiskCells(),
                        (processedRows, totalRows, insertedSoFar, duplicatesSoFar, errorsSoFar) -> {
                            job.processedRows = processedRows;
                            job.totalRows = totalRows;
                            job.insertedSoFar = insertedSoFar;
                            job.duplicatesSoFar = duplicatesSoFar;
                            job.errorsSoFar = errorsSoFar;
                            pushProgressEvent(session.getId(), "COMMIT", startedAt, processedRows, totalRows,
                                    insertedSoFar, duplicatesSoFar, errorsSoFar);
                        },
                        () -> jobTracker.isCancelled(session.getId()),
                        (chunkIndex, chunkStatus, rowsDone, rowsTotal) -> updateChunkSlot(job.chunks, chunkIndex, chunkStatus, rowsDone),
                        newRowResults -> newRowResults.stream().map(ImportSessionResponseBuilder::toRowResponse)
                                .forEach(job.liveInvalidRows::add));
                long durationMs = System.currentTimeMillis() - startedAt;

                List<ErrorDetail> errorDetails = result.rowResults().stream()
                        .filter(r -> r.status() == ImportProcessingService.RowStatus.INVALID)
                        .limit(MAX_ERROR_DETAILS)
                        .map(r -> new ErrorDetail(String.valueOf(r.rowNumber()), r.errorMessage(), r.solution()))
                        .toList();

                session.setInsertedRows(result.inserted());
                session.setDuplicateRows(result.duplicates());
                session.setErrorRows(result.errors());
                session.setValidRows(result.inserted() + result.duplicates());
                session.setCommittedAt(LocalDateTime.now());
                session.setDurationMs(durationMs);

                session.setStatus(result.cancelled() ? ImportSessionStatus.CANCELLED.value()
                        : result.invalidLimitReached() ? ImportSessionStatus.FAILED.value()
                        : result.errors() == 0 ? ImportSessionStatus.COMMITTED.value()
                        : result.inserted() == 0 ? ImportSessionStatus.FAILED.value()
                        : ImportSessionStatus.COMMITTED_WITH_ERRORS.value());
                if (!errorDetails.isEmpty()) {
                    String joined = errorDetails.stream().map(ErrorDetail::message).collect(Collectors.joining(" | "));
                    session.setMessage(joined.length() > 500 ? joined.substring(0, 500) : joined);
                }

                ImportSession saved = importSessionRepository.save(session);

                ImportSessionResponseBuilder.CappedErrorInfo cappedInfo = result.invalidLimitReached()
                        ? ImportSessionResponseBuilder.buildCappedErrorInfo(result)
                        : new ImportSessionResponseBuilder.CappedErrorInfo(List.of(), null, saved.getMessage());

                job.result = new CommitResultResponse(saved.getId(), saved.getOriginalFilename(), saved.getTableKey(),
                        saved.getStatus(), saved.getTotalRows(), saved.getValidRows(), saved.getErrorRows(),
                        saved.getDuplicateRows(), saved.getInsertedRows(), cappedInfo.message(), saved.getCommittedAt(),
                        durationMs, result.transactionStatus(), errorDetails, result.invalidLimitReached(),
                        cappedInfo.displayedInvalidRows(), cappedInfo.finalInvalidRow(), result.reconciliationStatus(),
                        result.reconciliationDigest());
                job.status = "DONE";
            } catch (Exception e) {

                if (!"CANCELLED".equals(job.status)) {
                    job.errorMessage = e.getMessage() != null ? e.getMessage() : "Import failed unexpectedly.";
                    job.status = "ERROR";
                }

                session.setStatus(priorStatus);
                importSessionRepository.save(session);
            }
        } finally {

            jobTracker.releasePhase(session.getId());
            sseRegistry.push(session.getId(), "done", Map.of("status", job.status));
            sseRegistry.complete(session.getId());
        }
    }

    private void pushProgressEvent(String sessionId, String stage, long startedAt, int processedRows, int totalRows,
                                    int insertedSoFar, int duplicatesSoFar, int errorsSoFar) {
        int pct = totalRows > 0 ? (int) Math.round(processedRows * 100.0 / totalRows) : 0;
        Double rowsPerSec = null;
        Long etaSeconds = null;
        if (processedRows > 0) {
            double elapsedSeconds = Math.max(0.001, (System.currentTimeMillis() - startedAt) / 1000.0);
            rowsPerSec = processedRows / elapsedSeconds;
            if (rowsPerSec > 0 && totalRows > processedRows) {
                etaSeconds = Math.round((totalRows - processedRows) / rowsPerSec);
            }
        }
        sseRegistry.push(sessionId, "progress", new ImportProgressEvent(stage, pct, processedRows, totalRows,
                insertedSoFar, duplicatesSoFar, errorsSoFar, rowsPerSec, etaSeconds));
    }

    private void requireNotYetImported(ImportSession session) {
        String status = session.getStatus();
        if (ImportSessionStatus.VALIDATING.matches(status) || ImportSessionStatus.COMMITTING.matches(status)) {
            throw new IllegalStateException("This upload is currently being processed (status: " + status + ").");
        }
        if (!ImportSessionStatus.UPLOADED.matches(status) && !ImportSessionStatus.VALIDATED.matches(status)
                && !ImportSessionStatus.CANCELLED.matches(status)) {
            throw new IllegalStateException("This upload has already been processed (status: " + status + ").");
        }
    }

    private void requireValidatedForCommit(ImportSession session) {
        String status = session.getStatus();
        if (ImportSessionStatus.VALIDATING.matches(status) || ImportSessionStatus.COMMITTING.matches(status)) {
            throw new IllegalStateException("This upload is currently being processed (status: " + status + ").");
        }
        if (!ImportSessionStatus.VALIDATED.matches(status) && !ImportSessionStatus.CANCELLED.matches(status)) {
            throw new IllegalStateException(
                    "This upload must be validated (Preview) before it can be imported (status: " + status + ").");
        }
    }

    private ImportUploadFileParser.ParsedRows readRows(ImportSession session) throws IOException {
        byte[] fileBytes = Files.readAllBytes(Paths.get(session.getStoredPath()));
        int sheetIndex = ImportUploadMetadata.fromJson(session.getMappingJson()).sheetIndex();
        return ImportUploadFileParser.parseRows(fileBytes, session.getFileType(), sheetIndex);
    }

    @GetMapping("/{id}/preview")
    public FilePreviewResponse preview(@PathVariable String id) throws IOException {
        ImportSession session = findSession(id);
        ImportUploadFileParser.ParsedRows parsed = readRows(session);
        return new FilePreviewResponse(parsed.headers(), parsed.rows());
    }

    @GetMapping("/{id}/download")
    @RequirePermission("page:data-upload.upload-history")
    public void download(@PathVariable String id, HttpServletResponse response, HttpServletRequest request) throws IOException {
        ImportSession session = null;
        try {
            session = findSession(id);
            byte[] fileBytes = Files.readAllBytes(Paths.get(session.getStoredPath()));

            String contentType = "csv".equals(session.getFileType())
                    ? "text/csv;charset=UTF-8"
                    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            response.setContentType(contentType);
            response.setHeader("Content-Disposition", "attachment; filename=\"" + session.getOriginalFilename() + "\"");
            response.getOutputStream().write(fileBytes);
            response.getOutputStream().flush();
            recordDownload(request, session.getOriginalFilename(), id, true, null);
        } catch (Exception ex) {
            recordDownload(request, session != null ? session.getOriginalFilename() : id, id, false, ex.getMessage());
            throw ex;
        }
    }

    private void recordDownload(HttpServletRequest request, String fileName, String fileKey, boolean success, String failureReason) {
        HttpSession session = request.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;
        if (authUser == null) {
            return;
        }
        monitoringAuditService.recordDownload(authUser.getUserId(), authUser.getUsername(),
                request.getRemoteAddr(), fileName, fileKey, success, failureReason);
    }

    @GetMapping("/export")
    @RequirePermission("page:data-upload.upload-history")
    public void exportLog(@RequestParam(defaultValue = "today") String mode,
                           @RequestParam(required = false) String start,
                           @RequestParam(required = false) String end,
                           HttpServletResponse response,
                           HttpServletRequest request) throws IOException {
        try {
            doExportLog(mode, start, end, response);
            recordDownload(request, "upload-log_" + mode + ".xlsx", null, true, null);
        } catch (Exception ex) {
            recordDownload(request, "upload-log_" + mode + ".xlsx", null, false, ex.getMessage());
            throw ex;
        }
    }

    private void doExportLog(String mode, String start, String end, HttpServletResponse response) throws IOException {
        List<ImportSession> sessions = importSessionRepository.findAll();
        String filenameSuffix;

        List<ImportSession> filtered;
        if ("range".equalsIgnoreCase(mode)) {
            if (start == null || end == null) {
                throw new IllegalArgumentException("Provide both 'start' and 'end' dates for a range export.");
            }
            LocalDate startDate = LocalDate.parse(start);
            LocalDate endDate = LocalDate.parse(end);
            if (endDate.isBefore(startDate)) {
                throw new IllegalArgumentException("Invalid range: end date must be on or after the start date.");
            }
            filtered = sessions.stream()
                    .filter(s -> {
                        LocalDate created = s.getCreatedAt().toLocalDate();
                        return !created.isBefore(startDate) && !created.isAfter(endDate);
                    })
                    .toList();
            filenameSuffix = "_" + start + "_to_" + end;
        } else {
            LocalDate today = LocalDate.now();
            filtered = sessions.stream()
                    .filter(s -> s.getCreatedAt().toLocalDate().equals(today))
                    .toList();
            filenameSuffix = "_" + today;
        }

        filtered = filtered.stream()
                .sorted(Comparator.comparing(ImportSession::getCreatedAt).reversed())
                .toList();

        ImportSessionResponseBuilder.writeHistoryWorkbook(filtered, response, "upload_history" + filenameSuffix + ".xlsx");
    }

    @Scheduled(cron = "0 5 0 * * *")
    void evictStaleJobTrackerEntries() {
        long cutoff = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        jobTracker.evictStaleJobs(cutoff);
        uploadJobTracker.evictStaleJobs(cutoff);
    }

    private ImportSession findSession(String id) {
        return importSessionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Import session not found: " + id));
    }
}
