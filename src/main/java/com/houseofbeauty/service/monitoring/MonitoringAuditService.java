package com.houseofbeauty.service.monitoring;

import com.houseofbeauty.model.IamLoginDownloadAudit;
import com.houseofbeauty.model.IamLoginUnauthorizedAudit;
import com.houseofbeauty.model.IamLoginUploadAudit;
import com.houseofbeauty.repository.IamLoginDownloadAuditRepository;
import com.houseofbeauty.repository.IamLoginUnauthorizedAuditRepository;
import com.houseofbeauty.repository.IamLoginUploadAuditRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
public class MonitoringAuditService {

    private final IamLoginDownloadAuditRepository downloadAuditRepository;
    private final IamLoginUploadAuditRepository uploadAuditRepository;
    private final IamLoginUnauthorizedAuditRepository unauthorizedAuditRepository;

    public MonitoringAuditService(IamLoginDownloadAuditRepository downloadAuditRepository,
                                   IamLoginUploadAuditRepository uploadAuditRepository,
                                   IamLoginUnauthorizedAuditRepository unauthorizedAuditRepository) {
        this.downloadAuditRepository = downloadAuditRepository;
        this.uploadAuditRepository = uploadAuditRepository;
        this.unauthorizedAuditRepository = unauthorizedAuditRepository;
    }

    public void recordDownload(Long userId, String username, String ipAddress,
                                String fileName, String fileKey, boolean success, String failureReason) {
        IamLoginDownloadAudit audit = new IamLoginDownloadAudit();
        audit.setUserId(userId);
        audit.setUsernameAttempted(username);
        audit.setFileName(fileName);
        audit.setFileKey(fileKey);
        audit.setSuccess(success);
        audit.setFailureReason(failureReason);
        audit.setIpAddress(ipAddress);
        audit.setAttemptedAt(LocalDateTime.now());
        downloadAuditRepository.save(audit);
    }

    public void recordUpload(Long userId, String username, String ipAddress,
                              String fileName, String tableKey, boolean success, String failureReason) {
        IamLoginUploadAudit audit = new IamLoginUploadAudit();
        audit.setUserId(userId);
        audit.setUsernameAttempted(username);
        audit.setFileName(fileName);
        audit.setTableKey(tableKey);
        audit.setSuccess(success);
        audit.setFailureReason(failureReason);
        audit.setIpAddress(ipAddress);
        audit.setAttemptedAt(LocalDateTime.now());
        uploadAuditRepository.save(audit);
    }

    public void recordUnauthorized(Long userId, String username, String ipAddress, String resource, String reason) {
        IamLoginUnauthorizedAudit audit = new IamLoginUnauthorizedAudit();
        audit.setUserId(userId);
        audit.setUsernameAttempted(username);
        audit.setResource(resource);
        audit.setReason(reason);
        audit.setIpAddress(ipAddress);
        audit.setAttemptedAt(LocalDateTime.now());
        unauthorizedAuditRepository.save(audit);
    }
}
