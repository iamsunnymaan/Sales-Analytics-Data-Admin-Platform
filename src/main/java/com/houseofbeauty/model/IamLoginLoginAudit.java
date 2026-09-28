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


@Entity
@Table(name = "IAM_Login_Login_Audit")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginLoginAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Audit_ID")
    private Long auditId;

    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Username_Attempted", length = 100, nullable = false)
    private String usernameAttempted;

    @Column(name = "Success", nullable = false)
    private Boolean success;

    @Column(name = "IP_Address", length = 50)
    private String ipAddress;

    @Column(name = "Attempted_At", nullable = false)
    private LocalDateTime attemptedAt;
}
