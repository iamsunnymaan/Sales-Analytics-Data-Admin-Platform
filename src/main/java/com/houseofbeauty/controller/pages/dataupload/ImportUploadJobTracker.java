package com.houseofbeauty.controller.pages.dataupload;

import com.houseofbeauty.dto.dataupload.response.UploadStatusResponse;
import com.houseofbeauty.model.ImportSession;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tracks the background /upload job (security scan + parse + checksum + disk write, see
 * {@link ImportSessionController#runUploadJob}) for every in-flight (or most-recently-finished)
 * upload — the same purely-in-memory-bookkeeping role {@link ImportProcessJobTracker} plays for
 * /process and /commit, just for the phase before an {@link ImportSession} even exists yet.
 */
class ImportUploadJobTracker {

    private final Map<String, UploadJob> jobs = new ConcurrentHashMap<>();

    // Same "plain volatiles, no lock" reasoning as ImportProcessJobTracker.ProcessJob — each field is
    // written by exactly one background job thread and only ever read by HTTP poll threads.
    static final class UploadJob {
        final long createdAt = System.currentTimeMillis();
        volatile String status = "RUNNING";
        volatile int processedRows = 0;
        volatile int totalRows = 0;
        volatile ImportSession result;
        volatile String errorMessage;
    }

    UploadJob start(String uploadId) {
        UploadJob job = new UploadJob();
        jobs.put(uploadId, job);
        return job;
    }

    // Polled by DataUploadPage.js every few hundred ms while a /upload job runs.
    UploadStatusResponse statusResponse(String uploadId) {
        UploadJob job = jobs.get(uploadId);
        if (job == null) {
            throw new IllegalArgumentException("No upload is running for this id.");
        }
        return new UploadStatusResponse(job.status, job.processedRows, job.totalRows, job.result, job.errorMessage);
    }

    // Same daily sweep cadence/cutoff as ImportProcessJobTracker#evictStaleJobs — see
    // ImportSessionController's own @Scheduled method for why. Never removes an entry still "RUNNING".
    void evictStaleJobs(long cutoffEpochMillis) {
        jobs.entrySet().removeIf(e -> !"RUNNING".equals(e.getValue().status) && e.getValue().createdAt < cutoffEpochMillis);
    }
}
