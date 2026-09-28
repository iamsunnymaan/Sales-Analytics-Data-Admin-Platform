package com.houseofbeauty.controller.pages.dataupload;

import com.houseofbeauty.dto.dataupload.response.UploadStatusResponse;
import com.houseofbeauty.model.ImportSession;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

class ImportUploadJobTracker {

    private final Map<String, UploadJob> jobs = new ConcurrentHashMap<>();

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

    UploadStatusResponse statusResponse(String uploadId) {
        UploadJob job = jobs.get(uploadId);
        if (job == null) {
            throw new IllegalArgumentException("No upload is running for this id.");
        }
        return new UploadStatusResponse(job.status, job.processedRows, job.totalRows, job.result, job.errorMessage);
    }

    void evictStaleJobs(long cutoffEpochMillis) {
        jobs.entrySet().removeIf(e -> !"RUNNING".equals(e.getValue().status) && e.getValue().createdAt < cutoffEpochMillis);
    }
}
