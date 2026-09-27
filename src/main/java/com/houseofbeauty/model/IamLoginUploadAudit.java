package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

// JPA mapping for IAM_Login_Upload_Audit (2026-09-16 migration) — one row per file upload
// attempt on the Upload Data page (ImportSessionController#upload), success or failure. Backs the
// Monitoring page's "Upload Attempts" section. Same nullable-User_ID + redundant
// Username_Attempted survives-account-deletion shape as IamLoginLoginAudit/IamLoginDownloadAudit.
@Entity
@Table(name = "IAM_Login_Upload_Audit")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUploadAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Upload_Audit_ID")
    private Long uploadAuditId;

    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Username_Attempted", length = 100, nullable = false)
    private String usernameAttempted;

    @Column(name = "File_Name", length = 255, nullable = false)
    private String fileName;

    @Column(name = "Table_Key", length = 50)
    private String tableKey;

    @Column(name = "Success", nullable = false)
    private Boolean success;

    @Column(name = "Failure_Reason", length = 255)
    private String failureReason;

    @Column(name = "IP_Address", length = 50)
    private String ipAddress;

    @Column(name = "Attempted_At", nullable = false)
    private LocalDateTime attemptedAt;
}
