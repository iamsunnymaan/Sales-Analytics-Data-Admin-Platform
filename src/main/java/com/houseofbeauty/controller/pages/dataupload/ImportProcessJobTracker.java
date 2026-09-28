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

class ImportProcessJobTracker {

    private final Map<String, ProcessJob> processJobs = new ConcurrentHashMap<>();
    private final Map<String, CommitJob> commitJobs = new ConcurrentHashMap<>();

    private final Map<String, ProcessJob> fullScanJobs = new ConcurrentHashMap<>();

    private final Map<String, AtomicBoolean> cancellationFlags = new ConcurrentHashMap<>();

    private final Map<String, String> activePhase = new ConcurrentHashMap<>();

    boolean tryAcquirePhase(String sessionId, String phase) {
        return activePhase.putIfAbsent(sessionId, phase) == null;
    }

    void releasePhase(String sessionId) {
        activePhase.remove(sessionId);
    }

    static final class ProcessJob {

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

        final List<RowResultResponse> liveInvalidRows = new CopyOnWriteArrayList<>();
    }

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

        final List<RowResultResponse> liveInvalidRows = new CopyOnWriteArrayList<>();
    }

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

    ProcessJob start(String sessionId, int totalRows, int workerCount) {
        cancellationFlags.remove(sessionId);
        ProcessJob job = new ProcessJob();
        job.totalRows = totalRows;
        job.workerCount = Math.max(1, workerCount);
        job.chunks = buildChunkSlots(totalRows, job.workerCount);
        processJobs.put(sessionId, job);
        return job;
    }

    CommitJob startCommit(String sessionId, int totalRows, int workerCount) {
        cancellationFlags.remove(sessionId);
        CommitJob job = new CommitJob();
        job.totalRows = totalRows;
        job.workerCount = Math.max(1, workerCount);
        job.chunks = buildChunkSlots(totalRows, job.workerCount);
        commitJobs.put(sessionId, job);
        return job;
    }

    ProcessJob startFullScan(String sessionId, int totalRows, int workerCount) {
        ProcessJob job = new ProcessJob();
        job.totalRows = totalRows;
        job.workerCount = Math.max(1, workerCount);
        job.chunks = buildChunkSlots(totalRows, job.workerCount);
        fullScanJobs.put(sessionId, job);
        return job;
    }

    void clearCancellation(String sessionId) {
        cancellationFlags.remove(sessionId);
    }

    void cancel(String sessionId) {
        cancellationFlags.computeIfAbsent(sessionId, key -> new AtomicBoolean()).set(true);
        ProcessJob job = processJobs.get(sessionId);
        if (job != null && "RUNNING".equals(job.status)) {

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

    void evictStaleJobs(long cutoffEpochMillis) {
        processJobs.entrySet().removeIf(e -> isStale(e.getValue().status, e.getValue().createdAt, cutoffEpochMillis));
        commitJobs.entrySet().removeIf(e -> isStale(e.getValue().status, e.getValue().createdAt, cutoffEpochMillis));
        fullScanJobs.entrySet().removeIf(e -> isStale(e.getValue().status, e.getValue().createdAt, cutoffEpochMillis));

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

    ProcessStatusResponse statusResponse(String sessionId) {
        ProcessJob job = get(sessionId);
        if (job == null) {
            throw new IllegalArgumentException("No validation is running for this upload.");
        }

        return new ProcessStatusResponse(job.status, job.processedRows, job.totalRows, job.insertedSoFar,
                job.duplicatesSoFar, job.errorsSoFar, job.result, job.errorMessage, job.workerCount,
                toChunkResponses(job.chunks), List.copyOf(job.liveInvalidRows));
    }

    ProcessStatusResponse fullScanStatusResponse(String sessionId) {
        ProcessJob job = fullScanJobs.get(sessionId);
        if (job == null) {
            throw new IllegalArgumentException("No full scan is running for this upload.");
        }

        return new ProcessStatusResponse(job.status, job.processedRows, job.totalRows, job.insertedSoFar,
                job.duplicatesSoFar, job.errorsSoFar, job.result, job.errorMessage, job.workerCount,
                toChunkResponses(job.chunks), List.copyOf(job.liveInvalidRows));
    }

    ValidationResultResponse fullScanResult(String sessionId) {
        ProcessJob job = fullScanJobs.get(sessionId);
        return job != null && "DONE".equals(job.status) ? job.result : null;
    }

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
