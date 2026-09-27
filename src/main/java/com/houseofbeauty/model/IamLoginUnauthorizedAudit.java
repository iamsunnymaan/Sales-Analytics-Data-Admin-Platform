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

// JPA mapping for IAM_Login_Unauthorized_Audit (2026-09-16 migration) — one row per blocked
// request: a 403 from PermissionInterceptor (/api/**) or a permission-denied redirect from
// PageAccessInterceptor (page documents). Backs the Monitoring page's "Unauthorized Access
// Attempts" section. Always an authenticated session (both interceptors already require login
// before this check runs), so Username_Attempted is always a real, known user — User_ID stays
// nullable for the same survives-account-deletion reason as the other audit tables here.
@Entity
@Table(name = "IAM_Login_Unauthorized_Audit")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUnauthorizedAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Unauthorized_Audit_ID")
    private Long unauthorizedAuditId;

    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Username_Attempted", length = 100, nullable = false)
    private String usernameAttempted;

    @Column(name = "Resource", length = 255, nullable = false)
    private String resource;

    @Column(name = "Reason", length = 255)
    private String reason;

    @Column(name = "IP_Address", length = 50)
    private String ipAddress;

    @Column(name = "Attempted_At", nullable = false)
    private LocalDateTime attemptedAt;
}
