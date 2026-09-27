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

/**
 * Drives the whole upload lifecycle: upload -> preview (dry-run) -> commit (real insert), plus
 * re-download/export of past uploads. This class is HTTP routing and session-lifecycle orchestration
 * only — every other concern lives in its own collaborator, in this same package:
 * <ul>
 *     <li>{@link ImportUploadFileParser} — CSV/XLSX parsing and cell-value normalization</li>
 *     <li>{@link ImportColumnValidator} — uploaded header row vs. target table schema</li>
 *     <li>{@link ImportProcessJobTracker} — background /process job state + cancellation signal</li>
 *     <li>{@link ImportSessionResponseBuilder} — JSON row/error shaping + upload-history .xlsx export</li>
 *     <li>{@link ImportProcessingService} — the actual row validation/insert engine</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/import-sessions")
@RequirePermission("page:data-upload")
public class
ImportSessionController extends BaseCrudController<ImportSession, String> {

    private static final Set<String> SUPPORTED_EXTENSIONS = Set.of("csv", "xlsx");
    private static final int PREVIEW_ROW_CAP = 20_000;
    private static final int MAX_ERROR_DETAILS = 5_000;
    // How far back to look for a same-table upload with an identical file checksum — matches the
    // design doc's own stated window for the duplicate-file warning.
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

    // Validates the request synchronously (fast, no file parsing needed) and hands the actual work —
    // security scan, parse (with real per-row progress), checksum, duplicate check, disk write, and
    // saving the session row — to a background job, mirroring the /process and /commit split below.
    // Without this split, none of that work reports any progress: the browser's upload bar tracks only
    // the byte transfer (see DataUploadPage.js), which finishes long before the server is actually
    // done, and for a large .xlsx the parse alone can take a while — see runUploadJob's own comment.
    //
    // sheetIndex is required only when the workbook has more than one sheet with actual data (see
    // ImportUploadFileParser#listDataSheets) — omitting it in that case fails fast (as an ERROR on the
    // job's status poll) with the sheet list rather than silently reading sheet 0, matching the
    // design's "ask, never guess" rule for multi-sheet files.
    @PostMapping("/upload")
    public UploadStartedResponse upload(@RequestParam("tableKey") String tableKey,
                                         @RequestParam("file") MultipartFile file,
                                         @RequestParam(value = "sheetIndex", required = false) Integer sheetIndex,
                                         HttpServletRequest request) throws IOException {
        // Captured here (the real request thread) rather than inside runUploadJob, which runs on a
        // background executor thread with no HttpServletRequest of its own — see that method's own
        // audit-logging calls at its DONE/ERROR terminal states.
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
        // Doubles as the eventual ImportSession's id — see runUploadJob — so the client never needs a
        // separate "job id" vs. "session id" to reconcile once the job finishes.
        String uploadId = UUID.randomUUID().toString();
        ImportUploadJobTracker.UploadJob job = uploadJobTracker.start(uploadId);
        taskExecutor.execute(() -> runUploadJob(uploadId, fileBytes, extension, originalFilename, table, sheetIndex,
                job, authUser, ipAddress));
        return new UploadStartedResponse(true, uploadId);
    }

    // Backs the Monitoring page's "Upload Attempts" section — see MonitoringAuditService's own
    // header comment. authUser can be null in principle (AuthenticationFilter already guarantees a
    // real session for this whole controller, but stays defensive rather than assuming).
    private void recordUpload(AuthenticatedUser authUser, String ipAddress, String fileName, String tableKey,
                               boolean success, String failureReason) {
        if (authUser == null) {
            return;
        }
        monitoringAuditService.recordUpload(authUser.getUserId(), authUser.getUsername(), ipAddress,
                fileName, tableKey, success, failureReason);
    }

    /** Live push of upload-parse progress. Polled by DataUploadPage.js every few hundred ms while a /upload job runs. */
    @GetMapping("/upload/{uploadId}/status")
    public UploadStatusResponse uploadStatus(@PathVariable String uploadId) {
        return uploadJobTracker.statusResponse(uploadId);
    }

    // The actual /upload work — everything that used to run synchronously inside the HTTP request
    // (see the class's own doc comment for why that made the "processing" gap after the browser's
    // upload bar hits 100% look like a hang). Content-based security checks happen BEFORE the file is
    // ever parsed as data — see ImportFileSecurityScanner's own javadoc for exactly what those catch
    // (mismatched content vs. extension, zip-bomb ratio, embedded macros) and why it's a lightweight
    // in-house check rather than a full MIME-sniffing library dependency. The xlsx branch opens the
    // workbook exactly once (shared between the sheet listing and the row parse — see openXlsxWorkbook's
    // own doc) and reports real, per-row progress into `job` as it parses (see ImportUploadFileParser's
    // onRowParsed callback) — not a time-based simulation, so the client's rows/sec and ETA (computed
    // client-side the same way updateRowProgress already does for Validate/Commit) reflect the actual
    // parse as it happens.
    // Pushes both live progress AND a terminal "done" event over SSE (see ImportSseEmitterRegistry) —
    // the same push this job's status already gets via polling (see uploadStatus), just delivered the
    // instant it happens instead of on the client's next scheduled check. This matters more here than
    // it sounds: a browser clamps a backgrounded/inactive tab's setTimeout-based poll loop to roughly
    // once per second REGARDLESS of the interval requested (confirmed live — see the DataUploadPage.js
    // POLL_INTERVAL_MS comment), so a client relying on polling alone can sit on a finished job for up
    // to a second before ever checking again. SSE message delivery isn't subject to that same timer
    // clamp, so DataUploadPage.js's openLiveProgress wakes the poll loop the moment this arrives (see
    // its own wakeupRef plumbing) instead of waiting out whatever's left of the current interval.
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

    // A workbook with more than one sheet that actually has data rows must have its sheet chosen
    // explicitly — never silently defaulted to sheet 0 — see the class javadoc on #upload. A CSV, or
    // an .xlsx with at most one qualifying sheet, has nothing to ask about.
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

    // Soft, non-blocking signal only — checked against this table's own recent uploads (any status),
    // never against other tables' files. Returns null (no warning) when nothing matches.
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

    /** Live push of /process and /commit progress for this session — see {@link ImportSseEmitterRegistry}. */
    @GetMapping("/{id}/events")
    public SseEmitter events(@PathVariable String id) {
        return sseRegistry.register(id);
    }

    /**
     * Dry-runs the uploaded file against the target table — attempts the real chunked insert logic
     * (see {@link ImportProcessingService}) inside transactions that always roll back, so Preview
     * exactly matches what a real Import would do without touching the database. Safe to call more
     * than once (e.g. re-opening the preview) as long as the session hasn't been imported yet.
     *
     * <p>Runs as a background job (see {@link ImportProcessJobTracker}) plus short client-side
     * polling of {@link #processStatus} — a large file's validation takes long enough that a
     * synchronous request would be a poor fit for the browser's own request lifecycle.
     *
     * <p>Two concurrency safeguards, layered: {@link ImportProcessJobTracker#tryAcquirePhase} is the
     * actual mutex (a single atomic map claim — see its javadoc for why a DB read-then-write alone
     * isn't enough) and is what this method waits on before responding; the session's own
     * {@code status} is eagerly flipped to "Validating" too, so the Upload History list and a
     * same-session {@link #commit} attempt both see accurate, up-to-date state rather than a stale
     * "Uploaded" for the whole duration of a large file's validation — but that write happens at the
     * very start of the background job (see {@link #runProcessJob}) rather than here, so this method
     * can respond the instant the (purely in-memory) mutex claim succeeds instead of also waiting on a
     * DB round trip first — one less thing between the click and the browser's poll loop actually
     * starting.
     */
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
        // The eager "Validating" flip (see #process's own doc on why this moved here) — first thing in
        // the job, before the (potentially slow) re-parse below, so it's still effectively immediate.
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
                    // Dry run only — nothing was ever going to be persisted either way, so cancelling
                    // simply reverts the eager "Validating" flip back to whatever it was before this
                    // attempt started, leaving the session exactly as retriable as it was pre-click.
                    session.setStatus(priorStatus);
                    importSessionRepository.save(session);
                    job.status = "CANCELLED";
                    return;
                }

                // Hitting the invalid-row cap is a hard validation FAILURE, not just "some issues to
                // review" — the session must never reach "Validated" (which is what gates /commit, see
                // requireValidatedForCommit) and the file must be corrected and re-uploaded from scratch
                // rather than retried in place (re-running /process on a "Failed" session is blocked by
                // requireNotYetImported).
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
                // A cancellation that raced with a mid-chunk failure (e.g. the stored file went missing
                // right as the user clicked "×") stays CANCELLED — that's the more useful signal to the
                // frontend, which already stopped watching this session either way.
                if (!"CANCELLED".equals(job.status)) {
                    job.errorMessage = e.getMessage() != null ? e.getMessage() : "Validation failed unexpectedly.";
                    job.status = "ERROR";
                }
                // Either way, the try block above never reached its own status-setting code — a
                // genuine system error (bad file on disk, DB unreachable, etc.) OR a cancellation that
                // raced with one must not leave the session permanently stuck on "Validating" (that
                // would make it un-retriable forever: requireNotYetImported only accepts
                // Uploaded/Validated/Cancelled). Revert to whatever it was before this attempt so the
                // user can simply try again.
                session.setStatus(priorStatus);
                importSessionRepository.save(session);
            }
        } finally {
            // Always releases, on every exit path above (success, cap-reached, cancelled, or error) —
            // this is what makes the session validatable/committable again for the next attempt.
            jobTracker.releasePhase(session.getId());
            // Terminal SSE push + close — any listener still attached (see ImportSseEmitterRegistry)
            // gets one last event before the stream ends; a client relying on polling instead never
            // notices, since ImportProcessJobTracker's own status endpoint already reflects the same
            // terminal job.status regardless of whether anything was listening over SSE.
            sseRegistry.push(session.getId(), "done", Map.of("status", job.status));
            sseRegistry.complete(session.getId());
        }
    }

    // Real per-chunk progress sink shared by runProcessJob/runCommitJob's ChunkProgressListener lambdas
    // — mutates the exact ChunkSlot ImportProcessJobTracker pre-built for this job (see
    // ImportProcessJobTracker.buildChunkSlots) in place, which is also what processStatus/commitStatus
    // read on every poll. Bounds-checked defensively even though the engine's own chunk count should
    // always match what was pre-built from the same totalRows/CHUNK_SIZE.
    private void updateChunkSlot(List<ImportProcessJobTracker.ChunkSlot> chunks, int chunkIndex, String status,
                                  int rowsDone) {
        if (chunkIndex < 0 || chunkIndex >= chunks.size()) {
            return;
        }
        ImportProcessJobTracker.ChunkSlot slot = chunks.get(chunkIndex);
        slot.status = status;
        slot.rowsDone = rowsDone;
    }

    // Polled by DataUploadPage.js every few hundred ms while a /process job runs.
    @GetMapping("/{id}/process/status")
    public ProcessStatusResponse processStatus(@PathVariable String id) {
        return jobTracker.statusResponse(id);
    }

    /**
     * The Data Preview card's "scan entire file & download all" option: re-reads the stored file and
     * re-validates it exactly like {@link #process}, except with {@link ImportLimits#FULL_SCAN_ROW_BUDGET}
     * substituted for the table's normal (small, fail-fast) invalid-row budget, so the whole file gets
     * scanned instead of stopping at the first handful of bad rows. Purely informational — unlike
     * {@link #process}, this never touches the session's own status or gates on it (repeatable any
     * number of times, from any session state, including "Failed"), and tracked in its own job map
     * (see {@link ImportProcessJobTracker#startFullScan}) so it can never collide with that session's
     * normal Preview job.
     */
    @PostMapping("/{id}/full-scan")
    public ProcessStartedResponse fullScan(@PathVariable String id) {
        ImportSession session = findSession(id);
        ImportProcessJobTracker.ProcessJob job = jobTracker.startFullScan(id, session.getTotalRows(),
                ImportLimits.MAX_PARALLEL_CHUNKS);
        taskExecutor.execute(() -> runFullScanJob(session, job));
        return new ProcessStartedResponse(true, session.getTotalRows());
    }

    // Polled by DataUploadPage.js every few hundred ms while a /full-scan job runs.
    @GetMapping("/{id}/full-scan/status")
    public ProcessStatusResponse fullScanStatus(@PathVariable String id) {
        return jobTracker.fullScanStatusResponse(id);
    }

    /**
     * The Data Preview card's own single download button (per explicit request: replaces the old
     * "download shown rows" / "scan entire file & download all" two-option menu) — called once
     * DataUploadPage.js's own /full-scan polling reaches "DONE". Streams the just-completed scan's
     * entire row set (valid and invalid together, see the filter removed from {@link #runFullScanJob}
     * above) as one .xlsx workbook, every invalid row's own offending cell shown in red text (see
     * {@link ImportSessionResponseBuilder#writeFullDatasetWorkbook}) — no separate Status column, the
     * red text alone is the signal.
     */
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

            // Every row — valid and invalid together — is kept here (unlike the old "non-VALID only"
            // filter this used to apply): the Data Preview card's single download button now exports
            // the whole dataset as one .xlsx, with each invalid row's own offending cell shown in red
            // (see ImportSessionResponseBuilder#writeFullDatasetWorkbook /
            // ImportSessionController#downloadFullScan below), not just an "invalid rows only" file.
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

    /**
     * Inserts the uploaded file's data rows into the target table — the header row is only ever
     * used to name columns, never inserted as data. The whole file commits as a single atomic
     * transaction (see {@link ImportProcessingService}): existing rows are never modified, rows that
     * already exist are skipped as duplicates, and a row that fails to insert is excluded and
     * reported — but if the invalid-row cap is hit or anything else goes wrong partway through, the
     * ENTIRE transaction rolls back, so this never leaves some rows committed and others not.
     * Re-validates fresh against the current state of the database rather than trusting an earlier
     * Preview call.
     *
     * <p>Runs as a background job (see {@link ImportProcessJobTracker}) plus short client-side
     * polling of {@link #commitStatus}, mirroring {@link #process}/{@link #processStatus} — a large
     * file's atomic insert takes long enough that a synchronous request would leave the browser (and
     * the user) with no live progress for the whole duration.
     *
     * <p><b>Duplicate-commit protection:</b> {@link ImportProcessJobTracker#tryAcquirePhase} is an
     * atomic claim — checking {@code session.getStatus()} here and only writing "Committing" later is
     * NOT itself atomic (two near-simultaneous requests, e.g. a double-click that beat the button's
     * own disabling, or two browser tabs, could both read "Validated" before either writes), so the
     * map claim is what actually guarantees only one commit ever runs for a given session at a time —
     * and it's also the only thing this method waits on before responding. The eager "Committing"
     * status write (just for accurate, immediate UI/history state, not the safety mechanism itself)
     * happens at the very start of the background job instead (see {@link #runCommitJob}), so a DB
     * round trip is never on the critical path between the click and the browser's poll loop starting.
     */
    // Method-level override of the class-level "page:data-upload" check — same reasoning
    // TableDataController's own truncateTable gives for overriding with
    // "page:data-upload.truncate-table": narrower than merely being able to view the page.
    // Section-level only ("page:data-upload.upload-verify" — the whole "2. Upload and Verify"
    // Section covers upload/verify/commit together, no separate Feature-level key for commit
    // specifically — see AuthBootstrapSeeder's own header comment).
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
        // workerCount 1 — commit runs every chunk sequentially inside one transaction (see
        // ImportAtomicCommitRunner), unlike Preview's bounded-parallel chunks.
        ImportProcessJobTracker.CommitJob job = jobTracker.startCommit(id, session.getTotalRows(), 1);
        taskExecutor.execute(() -> runCommitJob(session, job, priorStatus));

        return new CommitStartedResponse(true, session.getTotalRows());
    }

    // Polled by DataUploadPage.js every few hundred ms while a /commit job runs.
    @GetMapping("/{id}/commit/status")
    public CommitStatusResponse commitStatus(@PathVariable String id) {
        return jobTracker.commitStatusResponse(id);
    }

    private void runCommitJob(ImportSession session, ImportProcessJobTracker.CommitJob job, String priorStatus) {
        // The eager "Committing" flip (see #commit's own doc on why this moved here) — first thing in
        // the job, before the re-parse/insert below, so it's still effectively immediate.
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
                // Cancelled and cap-reached are each their own status rather than falling into the normal
                // errors/inserted logic below — the commit is one atomic transaction (see
                // ImportProcessingService.run), so either of these means the WHOLE transaction rolled back
                // and nothing landed at all, not just "some chunks made it in". Left retriable (see
                // requireValidatedForCommit) — a retry re-validates fresh, so rows this attempt would have
                // inserted are simply attempted again.
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

                // The capped-limit message wins over the session's own error digest when the cap was hit —
                // matches the pre-DTO behavior (see ImportSessionResponseBuilder.CappedErrorInfo) since
                // that's the message DataUploadPage.js actually shows in the hard-stop card.
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
                // A cancellation that raced with a mid-chunk failure stays CANCELLED — that's the more
                // useful signal to the frontend, which already stopped watching this session either way.
                if (!"CANCELLED".equals(job.status)) {
                    job.errorMessage = e.getMessage() != null ? e.getMessage() : "Import failed unexpectedly.";
                    job.status = "ERROR";
                }
                // The transaction template (see ImportAtomicCommitRunner) already guarantees nothing
                // partial landed in the DATABASE on any exception — but the SESSION ROW itself still
                // needs to come back out of "Committing", or it would be un-retriable forever
                // (requireValidatedForCommit only accepts Validated/Cancelled). Revert to whatever it
                // was before this attempt (i.e. "Validated", or "Cancelled" from an earlier attempt).
                session.setStatus(priorStatus);
                importSessionRepository.save(session);
            }
        } finally {
            // Always releases, on every exit path above (success, cap-reached, cancelled, or error) —
            // this is what makes the session committable again for the next attempt, and is the
            // release half of the mutex tryAcquirePhase claimed in commit() above.
            jobTracker.releasePhase(session.getId());
            sseRegistry.push(session.getId(), "done", Map.of("status", job.status));
            sseRegistry.complete(session.getId());
        }
    }

    // Shared by runProcessJob ("VALIDATE") and runCommitJob ("COMMIT") — same counters either job's
    // ProgressListener lambda already hands to ImportProcessJobTracker, just also pushed live over
    // SSE (see ImportSseEmitterRegistry) instead of waiting for the next poll. rowsPerSec/etaSeconds
    // stay null until at least one row has processed, and etaSeconds stays null once there's nothing
    // left to wait for.
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

    // Preview (/process) is only valid before a session has actually been committed once. "Cancelled"
    // is included alongside the normal pre-import statuses — a cancelled commit's own duplicate
    // check makes a retry safe (see commit() above), so there's no reason to strand the session.
    // "Failed" (validation hit the invalid-row cap) is deliberately excluded — that upload is done;
    // the user must correct the file and start a completely fresh upload (see runProcessJob).
    // "Validating"/"Committing" are also implicitly excluded (in-progress) — tryAcquirePhase is the
    // real concurrency guard (see commit()'s javadoc), this status check just gives a clear message
    // for the common case instead of the generic mutex-rejection one.
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

    // Commit may only run after a successful validation (status "Validated") — or after a previous
    // commit attempt was itself cancelled mid-way (status "Cancelled", only ever reachable from a
    // commit that started out "Validated" — see commit() above), never straight from "Uploaded". This
    // is what makes "never commit unvalidated data" a server-enforced rule rather than something that
    // only happens to hold because the UI always calls /process before /commit.
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

    // Re-reads the stored copy of the file rather than trusting anything cached from Upload.
    private ImportUploadFileParser.ParsedRows readRows(ImportSession session) throws IOException {
        byte[] fileBytes = Files.readAllBytes(Paths.get(session.getStoredPath()));
        int sheetIndex = ImportUploadMetadata.fromJson(session.getMappingJson()).sheetIndex();
        return ImportUploadFileParser.parseRows(fileBytes, session.getFileType(), sheetIndex);
    }

    /** Returns the uploaded file's own columns/rows (as parsed from the stored copy) for the preview popup. */
    @GetMapping("/{id}/preview")
    public FilePreviewResponse preview(@PathVariable String id) throws IOException {
        ImportSession session = findSession(id);
        ImportUploadFileParser.ParsedRows parsed = readRows(session);
        return new FilePreviewResponse(parsed.headers(), parsed.rows());
    }

    /** Re-downloads exactly the file that was uploaded, under its original filename. */
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

    // Backs the Monitoring page's "Download Attempts" section — see MonitoringAuditService's own
    // header comment. authUser is always non-null here: AuthenticationFilter already rejected an
    // unauthenticated request with 401 before this handler ever runs.
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

    /** Exports the upload log (today's entries, or a date range) as an Excel workbook. */
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

    // Sweeps jobTracker's in-memory process/commit-job bookkeeping (see ImportProcessJobTracker#
    // evictStaleJobs) once daily, same cadence and cutoff ("prior calendar day") as
    // ImportSessionCleanupService's own purge of the DB-backed session rows those jobs track —
    // offset 5 minutes after it so the DB rows are already gone by the time this runs.
    @Scheduled(cron = "0 5 0 * * *")
    void evictStaleJobTrackerEntries() {
        long cutoff = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        jobTracker.evictStaleJobs(cutoff);
        uploadJobTracker.evictStaleJobs(cutoff);
    }

    // Looks up a session or fails with a 404-mapped exception (see GlobalExceptionHandler).
    private ImportSession findSession(String id) {
        return importSessionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Import session not found: " + id));
    }
}
