package com.houseofbeauty.service.monitoring;

import com.houseofbeauty.model.IamLoginDownloadAudit;
import com.houseofbeauty.model.IamLoginUnauthorizedAudit;
import com.houseofbeauty.model.IamLoginUploadAudit;
import com.houseofbeauty.repository.IamLoginDownloadAuditRepository;
import com.houseofbeauty.repository.IamLoginUnauthorizedAuditRepository;
import com.houseofbeauty.repository.IamLoginUploadAuditRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

// Write side of the Monitoring page's three "Attempts" audit trails that aren't login itself
// (AuthService.recordAttempt already owns that one) — Download, Upload, and Unauthorized. Callers
// are expected to already have the acting session's userId/username/ipAddress in hand (every call
// site here — TableDataController, ImportSessionController, PermissionInterceptor,
// PageAccessInterceptor — already extracts AuthenticatedUser from the HttpSession for its own
// purposes anyway), so this stays a plain field-in, save-out service rather than reaching into
// HttpServletRequest itself. userId is nullable on every method for the same
// survives-account-deletion reason described on each entity's own header comment; username is
// always the real, resolved one since every write site here runs behind AuthenticationFilter
// (the request is always authenticated by the time any of these fire).
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

    // Explorer's /export (TableDataController) and Data Upload's re-download/log-export
    // (ImportSessionController) all funnel through here — fileKey is the table/session id behind
    // the download, null where there isn't a natural one (e.g. the upload-log export, which isn't
    // scoped to a single table).
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

    // ImportSessionController#upload — one row per file handed to the Upload Data page, whether
    // it was accepted for validation or rejected outright (wrong file type, unreadable, etc.).
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

    // PermissionInterceptor's 403 path and PageAccessInterceptor's permission-denied redirect path
    // (never its not-logged-in path — that's a 401/login-redirect, not an authorization denial) —
    // resource is the required permission key (API) or the requested page path (page document).
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
