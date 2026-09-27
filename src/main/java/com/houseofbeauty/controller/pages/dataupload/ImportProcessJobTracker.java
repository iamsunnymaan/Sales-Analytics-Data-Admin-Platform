package com.houseofbeauty.controller.pages.dataupload;

import com.houseofbeauty.dto.dataupload.response.ChunkStatusResponse;
import com.houseofbeauty.dto.dataupload.response.CommitResultResponse;
import com.houseofbeauty.dto.dataupload.response.CommitStatusResponse;
import com.houseofbeauty.dto.dataupload.response.ProcessStatusResponse;
import com.houseofbeauty.dto.dataupload.response.RowResultResponse;
import com.houseofbeauty.dto.dataupload.response.ValidationResultResponse;
import com.houseofbeauty.service.dataupload.import_common.ImportLimits;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Tracks the background /process (validation) and /commit (real import) jobs — and the cancellation
 * signal shared between them — for every import session. Backs {@link ImportSessionController#process}/
 * {@code #commit}, {@code #cancel}, {@code #processStatus}, and {@code #commitStatus}. One entry per
 * in-flight (or most-recently-finished) session id per job type; nothing here is session-row/database
 * state, it's purely in-memory bookkeeping for the currently-running (or last-run) background job.
 */
class ImportProcessJobTracker {

    private final Map<String, ProcessJob> processJobs = new ConcurrentHashMap<>();
    private final Map<String, CommitJob> commitJobs = new ConcurrentHashMap<>();
    // The Data Preview card's "scan entire file & download all" option (see ImportSessionController's
    // /full-scan) — a separate map from processJobs so a full scan never clobbers (or is clobbered
    // by) that session's own normal Preview job, even though both key off the same session id and
    // reuse the identical ProcessJob shape.
    private final Map<String, ProcessJob> fullScanJobs = new ConcurrentHashMap<>();
    // Checked by ImportProcessingService.run() between chunks during both process() (validate) and
    // commit() (real import) — a single flag per session id covers either, since only one of the two
    // is ever running for a given session at a time.
    private final Map<String, AtomicBoolean> cancellationFlags = new ConcurrentHashMap<>();

    // The actual mutual-exclusion primitive behind "never validate or commit the same session twice
    // at once, and never commit unvalidated data" — a plain DB status check-then-write in the
    // controller is NOT atomic on its own (two /commit requests can both read "Validated" before
    // either writes "Committing"), so this ConcurrentHashMap#compute-based claim is what actually
    // closes that race: only one caller for a given sessionId ever gets a non-null phase name back,
    // no matter how the two requests interleave. sessionId -> "VALIDATING" | "COMMITTING".
    private final Map<String, String> activePhase = new ConcurrentHashMap<>();

    /**
     * Atomically claims {@code sessionId} for {@code phase} — returns true iff no other phase
     * (validate or commit) is currently claimed for this session, in which case the claim is now
     * held. A false return means the caller must not start any work; it should reject the request
     * rather than proceed. Always paired with {@link #releasePhase}, called from a {@code finally}
     * block so a claim can never survive past the job that took it (success, cancel, or crash).
     */
    boolean tryAcquirePhase(String sessionId, String phase) {
        return activePhase.putIfAbsent(sessionId, phase) == null;
    }

    void releasePhase(String sessionId) {
        activePhase.remove(sessionId);
    }

    // Mutable, polled-from-another-thread progress snapshot for one in-flight /process call. Every
    // field is written by exactly one background job thread and only ever read by HTTP request
    // threads polling processStatus() — no field depends on another for consistency (a reader
    // seeing, say, an updated processedRows next to a stale totalRows for one tick is harmless, it
    // just self-corrects on the next poll), so plain volatiles are enough; no lock/synchronization
    // needed.
    static final class ProcessJob {
        // Registration time, not completion time — good enough for eviction purposes since a job is
        // never evicted while still "RUNNING" (see evictStaleJobs below) regardless of age, and every
        // real /process run finishes well within a day.
        final long createdAt = System.currentTimeMillis();
        volatile String status = "RUNNING";
        volatile int processedRows = 0;
        volatile int totalRows = 0;
        volatile int insertedSoFar = 0;
        volatile int duplicatesSoFar = 0;
        volatile int errorsSoFar = 0;
        volatile ValidationResultResponse result;
        volatile String errorMessage;
        volatile int workerCount = 1;
        volatile List<ChunkSlot> chunks = List.of();
        // Invalid/duplicate rows found so far, in the order their chunk finished — appended by
        // possibly-concurrent chunk-completion threads during Preview (see ImportValidationRunner's
        // bounded-parallel chunks), read by HTTP poll threads. Naturally bounded by this table's own
        // invalid-row budget (ImportLimits.MAX_INVALID_ROWS by default — at most 25), so no separate
        // cap is needed here.
        final List<RowResultResponse> liveInvalidRows = new CopyOnWriteArrayList<>();
    }

    // Same shape as ProcessJob, just carrying a CommitResultResponse instead — see the class javadoc
    // on ProcessJob for why plain volatiles (no lock) are enough here too.
    static final class CommitJob {
        final long createdAt = System.currentTimeMillis();
        volatile String status = "RUNNING";
        volatile int processedRows = 0;
        volatile int totalRows = 0;
        volatile int insertedSoFar = 0;
        volatile int duplicatesSoFar = 0;
        volatile int errorsSoFar = 0;
        volatile CommitResultResponse result;
        volatile String errorMessage;
        volatile int workerCount = 1;
        volatile List<ChunkSlot> chunks = List.of();
        // See ProcessJob#liveInvalidRows — Commit runs its chunks sequentially rather than in parallel,
        // but the same append-only, poll-read pattern applies.
        final List<RowResultResponse> liveInvalidRows = new CopyOnWriteArrayList<>();
    }

    // One chunk's live, real progress — real bookkeeping the row engine itself updates (see
    // ImportSessionController's chunk-progress lambda passed into ImportProcessingService.run()), not
    // a simulated animation. `lane` is a deterministic index % workerCount assignment purely for grid
    // layout — up to MAX_PARALLEL_CHUNKS chunks genuinely run concurrently during Preview (see
    // ImportValidationRunner), so which physical thread a given chunk actually lands on can differ
    // run to run, but "how many are in flight at once and what each one's real outcome was" is exact.
    // `status`/`rowsDone` are volatile (each field written by exactly one background job thread, only
    // ever read by HTTP poll threads) for the same reason ProcessJob/CommitJob's own fields are.
    static final class ChunkSlot {
        final int index;
        final int lane;
        final int rowsTotal;
        volatile String status = "pending";
        volatile int rowsDone = 0;

        ChunkSlot(int index, int lane, int rowsTotal) {
            this.index = index;
            this.lane = lane;
            this.rowsTotal = rowsTotal;
        }
    }

    // Splits totalRows into ImportLimits.CHUNK_SIZE-sized slots (the same partitioning
    // ImportValueNormalizer.partition performs on the real row list) purely to pre-size the chunk
    // list the poll response reports against — every slot starts "pending" and is only ever updated
    // by the real chunk-progress callback as that exact chunk actually runs.
    private static List<ChunkSlot> buildChunkSlots(int totalRows, int workerCount) {
        if (totalRows <= 0) {
            return List.of();
        }
        int lanes = Math.max(1, workerCount);
        int chunkCount = (totalRows + ImportLimits.CHUNK_SIZE - 1) / ImportLimits.CHUNK_SIZE;
        List<ChunkSlot> slots = new ArrayList<>(chunkCount);
        int remaining = totalRows;
        for (int i = 0; i < chunkCount; i++) {
            int rowsInChunk = Math.min(ImportLimits.CHUNK_SIZE, remaining);
            remaining -= rowsInChunk;
            slots.add(new ChunkSlot(i, i % lanes, rowsInChunk));
        }
        return slots;
    }

    /**
     * Registers a fresh job for this session, superseding whatever cancellation state an earlier
     * /process (or /commit) call left behind — e.g. the user cancelled once, then re-opened Preview.
     * {@code workerCount} is how many chunks this job can run concurrently (ImportLimits.MAX_PARALLEL_CHUNKS
     * for /process, 1 for /commit's sequential single-transaction run) — purely for lane layout, not
     * a scheduling parameter itself.
     */
    ProcessJob start(String sessionId, int totalRows, int workerCount) {
        cancellationFlags.remove(sessionId);
        ProcessJob job = new ProcessJob();
        job.totalRows = totalRows;
        job.workerCount = Math.max(1, workerCount);
        job.chunks = buildChunkSlots(totalRows, job.workerCount);
        processJobs.put(sessionId, job);
        return job;
    }

    /** Registers a fresh /commit job for this session — mirrors {@link #start}. */
    CommitJob startCommit(String sessionId, int totalRows, int workerCount) {
        cancellationFlags.remove(sessionId);
        CommitJob job = new CommitJob();
        job.totalRows = totalRows;
        job.workerCount = Math.max(1, workerCount);
        job.chunks = buildChunkSlots(totalRows, job.workerCount);
        commitJobs.put(sessionId, job);
        return job;
    }

    /** Registers a fresh /full-scan job for this session — mirrors {@link #start}, own job map. */
    ProcessJob startFullScan(String sessionId, int totalRows, int workerCount) {
        ProcessJob job = new ProcessJob();
        job.totalRows = totalRows;
        job.workerCount = Math.max(1, workerCount);
        job.chunks = buildChunkSlots(totalRows, job.workerCount);
        fullScanJobs.put(sessionId, job);
        return job;
    }

    /** Clears any stale cancellation flag without starting a new tracked job — used by commit(). */
    void clearCancellation(String sessionId) {
        cancellationFlags.remove(sessionId);
    }

    // Stops whichever of /process or /commit is currently running for this session — checked between
    // chunks inside ImportProcessingService.run() (see isCancelled() below), so it takes effect at
    // the next chunk boundary rather than instantly. Safe to call even if nothing is currently
    // running for this id (e.g. a stale "×" click after it already finished) — just a no-op flag with
    // nothing left to check it.
    void cancel(String sessionId) {
        cancellationFlags.computeIfAbsent(sessionId, key -> new AtomicBoolean()).set(true);
        ProcessJob job = processJobs.get(sessionId);
        if (job != null && "RUNNING".equals(job.status)) {
            // Gives the poller an immediate answer instead of waiting for the background thread to
            // notice the flag at its own next chunk boundary — the job's own cancelled check won't
            // overwrite this back to DONE/ERROR once it does notice.
            job.status = "CANCELLED";
        }
        CommitJob commitJob = commitJobs.get(sessionId);
        if (commitJob != null && "RUNNING".equals(commitJob.status)) {
            commitJob.status = "CANCELLED";
        }
    }

    boolean isCancelled(String sessionId) {
        AtomicBoolean flag = cancellationFlags.get(sessionId);
        return flag != null && flag.get();
    }

    ProcessJob get(String sessionId) {
        return processJobs.get(sessionId);
    }

    // Leak fix: processJobs/commitJobs/cancellationFlags previously grew forever — every /process and
    // /commit call adds an entry, and completion never removed it (statusResponse/commitStatusResponse
    // still need to answer one last poll after DONE/ERROR/CANCELLED). Called once daily (see
    // ImportSessionController's own @Scheduled sweep) with the same "prior calendar day" cutoff
    // ImportSessionCleanupService already uses for import_sessions rows — this is purely in-memory
    // bookkeeping for a job that has already finished, so it can go stale on exactly the same
    // timescale as the session data it was tracking. Never removes an entry still "RUNNING",
    // regardless of age — a stuck job should stay visible to a poller, not silently vanish.
    void evictStaleJobs(long cutoffEpochMillis) {
        processJobs.entrySet().removeIf(e -> isStale(e.getValue().status, e.getValue().createdAt, cutoffEpochMillis));
        commitJobs.entrySet().removeIf(e -> isStale(e.getValue().status, e.getValue().createdAt, cutoffEpochMillis));
        fullScanJobs.entrySet().removeIf(e -> isStale(e.getValue().status, e.getValue().createdAt, cutoffEpochMillis));
        // A cancellation flag only matters while its session has a live entry in one of the two maps
        // above (checked by isCancelled() from inside that same job's run loop) — once both are gone,
        // the flag is dead weight.
        cancellationFlags.keySet().removeIf(sessionId -> !processJobs.containsKey(sessionId) && !commitJobs.containsKey(sessionId));
    }

    private static boolean isStale(String status, long createdAt, long cutoffEpochMillis) {
        return !"RUNNING".equals(status) && createdAt < cutoffEpochMillis;
    }

    private static List<ChunkStatusResponse> toChunkResponses(List<ChunkSlot> chunks) {
        List<ChunkStatusResponse> responses = new ArrayList<>(chunks.size());
        for (ChunkSlot slot : chunks) {
            responses.add(new ChunkStatusResponse(slot.index, slot.lane, slot.status, slot.rowsDone, slot.rowsTotal));
        }
        return responses;
    }

    // Polled by DataUploadPage.js every few hundred ms while a /process job runs.
    ProcessStatusResponse statusResponse(String sessionId) {
        ProcessJob job = get(sessionId);
        if (job == null) {
            throw new IllegalArgumentException("No validation is running for this upload.");
        }

        return new ProcessStatusResponse(job.status, job.processedRows, job.totalRows, job.insertedSoFar,
                job.duplicatesSoFar, job.errorsSoFar, job.result, job.errorMessage, job.workerCount,
                toChunkResponses(job.chunks), List.copyOf(job.liveInvalidRows));
    }

    // Polled by DataUploadPage.js every few hundred ms while a /full-scan job runs.
    ProcessStatusResponse fullScanStatusResponse(String sessionId) {
        ProcessJob job = fullScanJobs.get(sessionId);
        if (job == null) {
            throw new IllegalArgumentException("No full scan is running for this upload.");
        }

        return new ProcessStatusResponse(job.status, job.processedRows, job.totalRows, job.insertedSoFar,
                job.duplicatesSoFar, job.errorsSoFar, job.result, job.errorMessage, job.workerCount,
                toChunkResponses(job.chunks), List.copyOf(job.liveInvalidRows));
    }

    // The last completed /full-scan's full result (valid + invalid rows together) for this session —
    // null if no scan has ever finished (still running, errored, or never started). Backs
    // ImportSessionController#downloadFullScan, called only after the frontend's own polling of
    // fullScanStatusResponse above already observed "DONE", so this should never actually return null
    // in practice; the null case just guards against a stale/direct call to the endpoint.
    ValidationResultResponse fullScanResult(String sessionId) {
        ProcessJob job = fullScanJobs.get(sessionId);
        return job != null && "DONE".equals(job.status) ? job.result : null;
    }

    // Polled by DataUploadPage.js every few hundred ms while a /commit job runs.
    CommitStatusResponse commitStatusResponse(String sessionId) {
        CommitJob job = commitJobs.get(sessionId);
        if (job == null) {
            throw new IllegalArgumentException("No import is running for this upload.");
        }

        return new CommitStatusResponse(job.status, job.processedRows, job.totalRows, job.insertedSoFar,
                job.duplicatesSoFar, job.errorsSoFar, job.result, job.errorMessage, job.workerCount,
                toChunkResponses(job.chunks), List.copyOf(job.liveInvalidRows));
    }
}
